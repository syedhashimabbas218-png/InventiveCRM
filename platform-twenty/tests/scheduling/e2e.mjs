// Scheduling end to end: real server, real app, provider test double, OSRM, Nominatim and Mailpit.
// Usage: node e2e.mjs <state file from setup.mjs> <api key file> [other workspace api key file]
import { readFileSync } from 'node:fs';

import { admin, apiClient, assert, booking, connectCalendar, keyClient, MAILPIT, mailTo, mock, sleep, summary, userToken, waitFor } from './lib.mjs';

const [stateFile, keyFile, otherKeyFile] = process.argv.slice(2);
const state = JSON.parse(readFileSync(stateFile, 'utf8'));
const W = state.workspaceUrl;
const api = keyClient(keyFile);
const { types, advisors } = state;
const adminToken = await userToken(W, 'admin@inventiveweb.test', 'Admin-Pass-1234!');
const bobToken = await userToken(W, 'bob@inventiveweb.test', 'Bob-Pass-1234!');
const LEEDS_LS6 = { lat: 53.8206, lng: -1.5772, label: 'LS6 2AB, Leeds', postcode: 'LS6 2AB' };
const COOKRIDGE = { lat: 53.8523, lng: -1.6044, label: 'Cookridge, Leeds', postcode: 'LS16 7AA' };
const YORK = { lat: 53.9583, lng: -1.0803, label: 'York', postcode: 'YO1 7HH' };

let client = 0;
const ip = () => ({ 'x-forwarded-for': `10.20.${Math.floor(client / 250)}.${(client++ % 250) + 1}` });
// Day 0 is the first Tuesday at least a week ahead (the fixtures were written for a Tuesday), so every test day stays
// inside the booking horizon and out of the past.
const WEEK_AHEAD = new Date(Date.now() + 7 * 86_400_000);
const BASE_DAY = new Date(WEEK_AHEAD.getTime() + ((2 - WEEK_AHEAD.getUTCDay() + 7) % 7) * 86_400_000);
const day = (offset) => new Date(Date.UTC(BASE_DAY.getUTCFullYear(), BASE_DAY.getUTCMonth(), BASE_DAY.getUTCDate() + offset)).toISOString().slice(0, 10);
const at = (offset, time) => `${day(offset)}T${time}:00.000Z`;

// Start from a clean slate: earlier runs' test bookings in this test workspace and the double's events.
await mock('/admin/reset', {});
for (const mutation of ['destroySlotReservations', 'destroyCalendarSyncs', 'destroyAppointmentParticipants', 'destroySchedulingAuditEvents', 'destroyAppointments', 'destroyPublicRequestCounters'])
  await api.gql(`mutation { ${mutation}(filter: { id: { is: NOT_NULL } }) { id } }`);

const tickets = {};
for (const slug of Object.values(types)) tickets[slug] = (await booking(W, { action: 'page', slug }, ip())).body.ticket;
await sleep(3200);

const slots = async (slug, from, days = 1, extra = {}) => {
  const response = await booking(W, { action: 'slots', slug, from, days, ...extra }, ip());
  if (response.status !== 200) console.log(`slots ${slug} answered ${response.status}: ${JSON.stringify(response.body).slice(0, 300)}`);
  return response.body;
};
const book = (slug, start, customer, extra = {}) =>
  booking(W, { action: 'book', slug, ticket: tickets[slug], start, customer: { timeZone: 'Europe/London', ...customer }, answers: { topic: 'Pensions' }, idempotencyKey: `${slug}-${start}-${customer.email}`, ...extra }, extra.headers ?? ip());
const appointmentByEmail = async (email) =>
  (await api.gql(`query($email: String!) { appointments(filter: { customerEmail: { eq: $email } }, orderBy: [{ createdAt: DescNullsLast }], first: 5) { edges { node { id status startsAt endsAt advisorId meetingUrl location calendarStatus assignmentReason travelMinutes travelCheck sessionKey seat personId manageNonce participants { edges { node { advisorId participantRole } } } } } } }`, { email })).appointments.edges.map((edge) => edge.node);
const synced = (email) => waitFor(`calendar sync for ${email}`, async () => (await appointmentByEmail(email)).find((appointment) => appointment.calendarStatus === 'SYNCED'), 60000).catch(() => null);
const events = async (email) => mock(`/admin/events?email=${encodeURIComponent(email)}`);
const tokenFromEmail = async (address) => {
  const message = await waitFor(`email to ${address}`, async () => (await inbox(address))[0], 30000);
  const full = await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json();
  return { message: full, token: /booking\/manage\/([\w.-]+)/.exec(full.Text)?.[1] ?? null };
};
const run = state.run;
// Reruns reuse the same addresses, so mail checks only look at this run's messages.
const startedAt = Date.now();
const inbox = (address) => mailTo(address, startedAt);
const email = (name) => `${name}.${run}@customers.test`;

// 1-3. One-to-one with a Google advisor; busy time blocks; booking lands in Twenty and Google.
const connections = (await admin(W, adminToken, { action: 'connections' })).body.connections;
assert('Alice has Google connected, with her calendars listed', connections.some((connection) => connection.provider === 'GOOGLE' && connection.status === 'CONNECTED' && connection.calendars.length === 2), connections.map((c) => `${c.name} ${c.status} ${c.calendars.length} calendars`).join('; '));

await mock('/admin/busy', { provider: 'google', email: 'alice@googlemail.test', calendarId: 'alice@googlemail.test', title: 'Dentist (private)', start: at(2, '10:00'), end: at(2, '11:00') });
const aliceDay = (await slots(types.aliceIntro, at(2, '00:00'))).slots.map((slot) => slot.start.slice(11, 16));
assert('a busy event in Google removes the clashing times', aliceDay.includes('09:30') && !aliceDay.includes('10:00') && !aliceDay.includes('10:30') && aliceDay.includes('11:00'), aliceDay.join(' '));

const ann = email('ann');
const first = await book(types.aliceIntro, at(2, '11:00'), { name: 'Ann Customer', email: ann, phone: '+44 7700 900111' });
assert('a customer books Alice without an account', first.status === 200 && first.body.status === 'CONFIRMED' && first.body.advisorName === 'Alice Google', JSON.stringify(first.body).slice(0, 200));
const annAppointment = await synced(ann);
const googleEvents = await events('alice@googlemail.test');
const annEvent = googleEvents.find((event) => event.origin === 'app' && event.start === at(2, '11:00'));
assert('the booking is a Twenty record linked to a new contact, and is in Google with a Meet link', Boolean(annAppointment?.personId) && Boolean(annEvent) && annAppointment.meetingUrl?.startsWith('https://meet.google.com/'), `${annAppointment?.calendarStatus} ${annAppointment?.meetingUrl}`);
const person = (await api.gql(`query($id: UUID!) { people(filter: { id: { eq: $id } }) { edges { node { emails { primaryEmail } name { firstName } } } } }`, { id: annAppointment?.personId })).people.edges[0]?.node;
assert('the contact was created from the booking details', person?.emails.primaryEmail === ann && person?.name.firstName === 'Ann', JSON.stringify(person));
const again = await book(types.aliceIntro, at(2, '11:00'), { name: 'Ann Customer', email: ann });
assert('a repeated submit returns the same booking instead of a second one', again.status === 200 && (await appointmentByEmail(ann)).length === 1, `${again.status} ${(await appointmentByEmail(ann)).length} appointments`);
const { message: confirmation, token: annToken } = await tokenFromEmail(ann);
assert('the customer gets a confirmation with a calendar invitation and a manage link', /Booked/.test(confirmation.Subject) && confirmation.Attachments.some((file) => /calendar|ics/.test(file.ContentType)) && Boolean(annToken), `${confirmation.Subject} | ${confirmation.Attachments.map((file) => file.ContentType).join(',')}`);
assert('Alice is told about the new booking', (await inbox('alice@inventiveweb.test')).some((message) => /New booking/.test(message.Subject)));

// 4. A different user on Microsoft receives a booking.
const bo = email('bo');
const bobBooking = await book(types.bobConsult, at(2, '13:00'), { name: 'Bo Customer', email: bo });
const boAppointment = await synced(bo);
const graphEvent = (await events('bob@outlook.test')).find((event) => event.start === at(2, '13:00'));
assert('Bob, on Microsoft, receives a booking in Outlook with a Teams link', bobBooking.status === 200 && Boolean(graphEvent) && boAppointment?.meetingUrl?.startsWith('https://teams.microsoft.com/'), `${bobBooking.status} ${boAppointment?.meetingUrl}`);
assert('no customer is added as an Outlook attendee, so Microsoft sends no second invitation', graphEvent?.attendees?.length === 0);

// 5. Round robin spreads bookings evenly across free advisors.
const rrAdvisors = [];
for (const [index, time] of ['09:00', '09:30', '14:00'].entries()) {
  const customer = email(`rr${index}`);
  const result = await book(types.roundRobin, at(3, time), { name: `RR ${index}`, email: customer, phone: '+44 7700 900222' });
  rrAdvisors.push(result.body.advisorName);
}
// Carol does not take remote meetings, so this phone appointment rotates between Alice and Bob.
assert('round robin rotates evenly between the advisors who offer phone calls', rrAdvisors.filter((name) => name === 'Alice Google').length >= 1 && rrAdvisors.filter((name) => name === 'Bob Outlook').length >= 1 && !rrAdvisors.includes('Carol Headingley'), rrAdvisors.join(', '));
const rrReason = (await appointmentByEmail(email('rr0')))[0]?.assignmentReason;
assert('the reason for each assignment is recorded', /EQUAL/.test(rrReason ?? ''), rrReason);

// 13. Two customers try the same slot at once.
const [raceA, raceB] = await Promise.all([
  book(types.bobConsult, at(4, '10:00'), { name: 'Racer A', email: email('race-a') }),
  book(types.bobConsult, at(4, '10:00'), { name: 'Racer B', email: email('race-b') }),
]);
assert('two simultaneous bookings for one advisor and slot: one wins, the other is told it is taken', [raceA.status, raceB.status].sort().join() === '200,409', `${raceA.status} ${raceB.status} ${raceB.body?.message ?? raceA.body?.message}`);
const [rrA, rrB] = await Promise.all([
  book(types.roundRobin, at(4, '11:00'), { name: 'Team A', email: email('team-a'), phone: '+44 7700 900333' }),
  book(types.roundRobin, at(4, '11:00'), { name: 'Team B', email: email('team-b'), phone: '+44 7700 900444' }),
]);
assert('two simultaneous round-robin bookings for one slot go to two different advisors', rrA.status === 200 && rrB.status === 200 && rrA.body.advisorName !== rrB.body.advisorName, `${rrA.body.advisorName} / ${rrB.body.advisorName}`);

// Collective: only times when everyone is free, and both calendars get the event.
const collectiveDay = (await slots(types.collective, at(2, '00:00'))).slots.map((slot) => slot.start.slice(11, 16));
assert('collective times exclude anyone busy (Alice at 10:00 and 11:00, Bob at 13:00)', !collectiveDay.includes('10:00') && !collectiveDay.includes('11:00') && !collectiveDay.includes('13:00') && collectiveDay.includes('15:00'), collectiveDay.join(' '));
const cy = email('cy');
const cyBooking = await book(types.collective, at(2, '15:00'), { name: 'Cy Customer', email: cy });
const cyAppointment = await synced(cy);
assert('a collective meeting holds both advisors and is in both calendars', cyAppointment?.participants.edges.length === 2 && (await events('alice@googlemail.test')).some((event) => event.start === at(2, '15:00')) && (await events('bob@outlook.test')).some((event) => event.start === at(2, '15:00')), `${cyAppointment?.participants.edges.length} participants; booking ${cyBooking.status} ${cyBooking.body?.message ?? ''}`);

// Group sessions fill up to capacity.
const groupResults = [];
for (const name of ['g1', 'g2', 'g3', 'g4']) groupResults.push((await book(types.group, at(5, '10:00'), { name, email: email(name) })).status);
const groupSlot = (await slots(types.group, at(5, '00:00'))).slots.find((slot) => slot.start === at(5, '10:00'));
assert('a group session takes three people and refuses the fourth', groupResults.join() === '200,200,200,409' && !groupSlot, groupResults.join());
await synced(email('g3'));
assert('the group session is one calendar event for all of them', (await events('alice@googlemail.test')).filter((event) => event.start === at(5, '10:00') && event.status !== 'cancelled').length === 1);

// 6. Physical appointment at an office.
const di = email('di');
const officeBooking = await book(types.office, at(3, '10:00'), { name: 'Di Customer', email: di });
const diAppointment = (await appointmentByEmail(di))[0];
assert('an office appointment is booked with the office address', officeBooking.status === 200 && /Park Row/.test(diAppointment?.location ?? ''), diAppointment?.location);

// 7-8. Map selector and nearest advisor, with road routing.
const nearby = (await booking(W, { action: 'advisors', slug: types.nearest, location: LEEDS_LS6 }, ip())).body;
const names = nearby.advisors.map((advisor) => `${advisor.name} ${advisor.distanceKm}km ${advisor.travelMinutes}min`);
assert('the map selector finds advisors covering Headingley, nearest first, by road', nearby.routing === 'ROAD' && nearby.advisors[0]?.name === 'Carol Headingley' && nearby.advisors.some((advisor) => advisor.name === 'Dan Morley') && !nearby.advisors.some((advisor) => advisor.name === 'Eve York'), names.join('; '));
assert('advisor bases are not exposed exactly', nearby.advisors.every((advisor) => !advisor.point || advisor.point.approximate), JSON.stringify(nearby.advisors[0]?.point));
const ed = email('ed');
const nearest = await book(types.nearest, at(6, '10:00'), { name: 'Ed Customer', email: ed }, { location: LEEDS_LS6 });
const edAppointment = (await appointmentByEmail(ed))[0];
assert('the nearest available advisor gets the home visit, with travel checked by road routing', nearest.body.advisorName === 'Carol Headingley' && /road routing/.test(edAppointment?.travelCheck ?? ''), `${nearest.body.advisorName} ${edAppointment?.travelMinutes}min ${edAppointment?.travelCheck}`);
const yorkNearby = (await booking(W, { action: 'advisors', slug: types.territory, location: YORK }, ip())).body;
assert('territory matching sends a York customer only to the advisor covering YO', yorkNearby.advisors.map((advisor) => advisor.name).join() === 'Eve York', yorkNearby.advisors.map((advisor) => advisor.name).join());
const carolLater = (await slots(types.choose, at(6, '00:00'), 1, { advisorId: advisors.carol, location: COOKRIDGE })).slots.map((slot) => slot.start.slice(11, 16));
assert('travel-aware: Carol is not offered 11:00 in Cookridge straight after her 10:00 Headingley visit, but is offered 12:00', !carolLater.includes('11:00') && carolLater.includes('12:00'), carolLater.join(' '));

// 9. The customer reschedules through their link.
const manage = (await booking(W, { action: 'manage', token: annToken }, ip())).body;
const newTimes = (await booking(W, { action: 'rescheduleSlots', token: annToken, from: at(2, '00:00'), days: 1 }, ip())).body.slots.map((slot) => slot.start);
const moved = await booking(W, { action: 'reschedule', token: annToken, start: at(2, '11:30') }, ip());
await sleep(4000);
const annMoved = (await appointmentByEmail(ann))[0];
const annGoogle = (await events('alice@googlemail.test')).find((event) => event.id === annEvent?.id);
assert('the customer can move 30 minutes later, overlapping the old time', manage.canReschedule && newTimes.includes(at(2, '11:30')) && moved.status === 200 && annMoved.startsAt === at(2, '11:30'), `${moved.status} ${moved.body?.message ?? ''} ${annMoved.startsAt}`);
assert('the Google event moved with it, and the customer was told', annGoogle?.start === at(2, '11:30') && (await waitFor('reschedule email', async () => (await inbox(ann)).some((message) => /Moved/.test(message.Subject)), 30000).catch(() => false)), annGoogle?.start);
const fake = await booking(W, { action: 'manage', token: `${annMoved.id}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` }, ip());
assert('a guessed manage link is refused', fake.status === 404);

// 10. The advisor cancels in Twenty.
await apiClient(bobToken, W).gql(`mutation($id: UUID!) { updateAppointment(id: $id, data: { status: CANCELLED, cancelReason: "Advisor unwell" }) { id } }`, { id: boAppointment.id });
const boCancelled = await waitFor('cancellation handled', async () => ((await events('bob@outlook.test')).find((event) => event.id === graphEvent.id)?.status === 'deleted' ? true : null), 60000).catch(() => false);
const freeAgain = (await slots(types.bobConsult, at(2, '00:00'))).slots.some((slot) => slot.start === at(2, '13:00'));
assert('an advisor cancelling in Twenty removes the Outlook event, frees the slot and emails the customer', boCancelled && freeAgain && (await waitFor('cancel email', async () => (await inbox(bo)).some((message) => /Cancelled/.test(message.Subject)), 30000).catch(() => false)));

// 12. A disconnected calendar is not ignored.
await mock('/admin/revoke', { email: 'bob@outlook.test' });
const whileRevoked = (await slots(types.bobConsult, at(7, '00:00'))).slots.length;
const bobConnections = (await admin(W, bobToken, { action: 'connections' })).body.connections;
await mock('/admin/revoke', { email: 'bob@outlook.test', revoked: false });
assert('when Bob revokes access, his times are withdrawn rather than offered blind, and the connection is flagged', whileRevoked === 0 && bobConnections.some((connection) => connection.status === 'NEEDS_RECONNECT' || connection.status === 'ERROR'), `${whileRevoked} slots, ${bobConnections.map((c) => c.status).join(',')}`);
const stillFlagged = (await admin(W, bobToken, { action: 'connections' })).body.connections;
await connectCalendar({ token: bobToken, workspaceUrl: W, applicationId: state.applicationId, providerName: 'microsoft-calendar', provider: 'microsoft', email: 'bob@outlook.test', reconnectingConnectedAccountId: stillFlagged[0]?.connectionId });
await slots(types.bobConsult, at(7, '00:00'));
const reconnected = (await admin(W, bobToken, { action: 'connections' })).body.connections;
const afterReconnect = (await slots(types.bobConsult, at(7, '00:00'))).slots.length;
assert('the connection stays flagged until Bob reconnects, then his times come back', stillFlagged.every((connection) => connection.status !== 'CONNECTED') && reconnected.length === 1 && reconnected[0].status === 'CONNECTED' && afterReconnect > 0, `before ${stillFlagged.map((c) => c.status)}, after ${reconnected.map((c) => c.status)} with ${afterReconnect} slots`);

// Provider outage during a calendar write: retried by the sync job, no duplicates.
const fi = email('fi');
await mock('/admin/outage', { email: 'alice@googlemail.test', on: false });
await book(types.aliceIntro, at(8, '09:00'), { name: 'Fi Customer', email: fi });
await synced(fi);
const fiAppointment = (await appointmentByEmail(fi))[0];
await mock('/admin/outage', { email: 'alice@googlemail.test', on: true });
await api.gql(`mutation($id: UUID!, $data: AppointmentUpdateInput!) { updateAppointment(id: $id, data: $data) { id } }`, { id: fiAppointment.id, data: { startsAt: at(8, '12:00'), endsAt: at(8, '12:30') } });
const failing = await waitFor('sync failure recorded', async () => ((await appointmentByEmail(fi))[0].calendarStatus === 'PENDING' ? true : null), 60000).catch(() => false);
await mock('/admin/outage', { email: 'alice@googlemail.test', on: false });
await api.gql(`mutation { updateCalendarSyncs(filter: { status: { eq: FAILED } }, data: { nextAttemptAt: null }) { id } }`).catch(() => null);
const syncNow = await fetch(`${W}/s/scheduling/sync-now`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: '{}' });
const recovered = (await appointmentByEmail(fi))[0];
const fiEvents = (await events('alice@googlemail.test')).filter((event) => event.title?.includes('Fi Customer') && event.status !== 'cancelled');
assert('a Google outage during a move is retried and recovers without a duplicate event', failing && syncNow.ok && recovered.calendarStatus === 'SYNCED' && fiEvents.length === 1 && fiEvents[0].start === at(8, '12:00'), `pending seen: ${failing}, now ${recovered.calendarStatus}, events ${fiEvents.length} at ${fiEvents[0]?.start}`);

// External edits in Google are put back (Twenty is the source of truth).
await mock('/admin/edit-event', { email: 'alice@googlemail.test', id: fiEvents[0].id, start: at(8, '16:00'), end: at(8, '16:30') });
await fetch(`${W}/s/scheduling/sync-now`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: '{}' });
const restored = (await events('alice@googlemail.test')).find((event) => event.id === fiEvents[0].id);
assert('an event moved directly in Google is moved back to the booked time and logged', restored?.start === at(8, '12:00'), restored?.start);

// Google rate limits arrive as 403: they are retried, and the account is not flagged for reconnecting.
const ri = email('ri');
await book(types.aliceIntro, at(8, '14:00'), { name: 'Ri Customer', email: ri });
await synced(ri);
const riAppointment = (await appointmentByEmail(ri))[0];
await mock('/admin/outage', { email: 'alice@googlemail.test', on: true, mode: 'rate-limit' });
await api.gql(`mutation($id: UUID!, $data: AppointmentUpdateInput!) { updateAppointment(id: $id, data: $data) { id } }`, { id: riAppointment.id, data: { startsAt: at(8, '15:00'), endsAt: at(8, '15:30') } });
const rateLimited = await waitFor('rate-limited sync recorded', async () => ((await appointmentByEmail(ri))[0].calendarStatus === 'PENDING' ? true : null), 60000).catch(() => false);
const whileLimited = (await admin(W, adminToken, { action: 'connections' })).body.connections.find((connection) => connection.provider === 'GOOGLE');
await mock('/admin/outage', { email: 'alice@googlemail.test', on: false });
await api.gql(`mutation { updateCalendarSyncs(filter: { status: { eq: FAILED } }, data: { nextAttemptAt: null }) { id } }`).catch(() => null);
await fetch(`${W}/s/scheduling/sync-now`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: '{}' });
assert('a Google rate limit (403 rateLimitExceeded) is retried without asking Alice to reconnect', rateLimited && whileLimited?.status !== 'NEEDS_RECONNECT' && (await appointmentByEmail(ri))[0].calendarStatus === 'SYNCED', `pending seen: ${rateLimited}, connection ${whileLimited?.status}`);

// calendar.events.owned: a calendar shared with Alice can block her time but cannot receive bookings.
const aliceGoogle = (await admin(W, adminToken, { action: 'connections' })).body.connections.find((connection) => connection.provider === 'GOOGLE');
const shared = aliceGoogle.calendars.find((calendar) => !calendar.primary);
const toShared = await admin(W, adminToken, { action: 'saveConnection', settingId: aliceGoogle.id, availabilityCalendarIds: aliceGoogle.availabilityCalendarIds, bookingCalendarId: shared.id, conferencing: aliceGoogle.conferencing });
const blockShared = await admin(W, adminToken, { action: 'saveConnection', settingId: aliceGoogle.id, availabilityCalendarIds: [...new Set([...aliceGoogle.availabilityCalendarIds, shared.id])], bookingCalendarId: aliceGoogle.bookingCalendarId, conferencing: aliceGoogle.conferencing });
await admin(W, adminToken, { action: 'saveConnection', settingId: aliceGoogle.id, availabilityCalendarIds: aliceGoogle.availabilityCalendarIds, bookingCalendarId: aliceGoogle.bookingCalendarId, conferencing: aliceGoogle.conferencing });
assert('a shared (writer) Google calendar can block availability but is refused as the booking calendar', !shared.canWrite && toShared.status === 400 && blockShared.status === 200, `canWrite ${shared.canWrite}, booking ${toShared.status}, blocking ${blockShared.status}`);

// Granular consent: when Alice unticks the events permission, her account is paused with a reason, no event calls are
// made, and reconnecting with every permission brings her times back.
await mock('/admin/withhold-scopes', { provider: 'google', email: 'alice@googlemail.test', scopes: ['calendar.events.owned'] });
await connectCalendar({ token: adminToken, workspaceUrl: W, applicationId: state.applicationId, providerName: 'google-calendar', provider: 'google', email: 'alice@googlemail.test', reconnectingConnectedAccountId: aliceGoogle.connectionId });
const partial = (await admin(W, adminToken, { action: 'connections' })).body.connections.find((connection) => connection.provider === 'GOOGLE');
const partialSlots = (await slots(types.aliceIntro, at(10, '00:00'))).slots.length;
await mock('/admin/withhold-scopes', { provider: 'google', email: 'alice@googlemail.test', scopes: [] });
await connectCalendar({ token: adminToken, workspaceUrl: W, applicationId: state.applicationId, providerName: 'google-calendar', provider: 'google', email: 'alice@googlemail.test', reconnectingConnectedAccountId: aliceGoogle.connectionId });
const full = (await admin(W, adminToken, { action: 'connections' })).body.connections.find((connection) => connection.provider === 'GOOGLE');
const fullSlots = (await slots(types.aliceIntro, at(10, '00:00'))).slots.length;
assert('a partial Google grant pauses the account with the missing permission named, and a full grant restores it', partial?.status === 'NEEDS_RECONNECT' && /did not grant/.test(partial?.error ?? '') && partialSlots === 0 && full?.status === 'CONNECTED' && fullSlots > 0, `partial ${partial?.status} "${partial?.error}" ${partialSlots} slots, full ${full?.status} ${fullSlots} slots`);

// Time zones: a New York customer sees New York times in their email.
const gi = email('gi');
await book(types.aliceIntro, at(9, '14:00'), { name: 'Gi Customer', email: gi, timeZone: 'America/New_York' });
const giMail = await waitFor('NY email', async () => (await inbox(gi))[0], 30000).catch(() => null);
assert('a customer in New York gets times in their own zone', /09:00 to 09:30 \(America\/New_York\)/.test(giMail?.Subject ?? '') || /09:00/.test(giMail?.Snippet ?? ''), giMail?.Subject);

// Reminders at the configured intervals.
// The first interval is already due (an hour more than the time left), the second is not.
const firstReminder = Math.ceil((Date.parse(at(9, '14:00')) - Date.now()) / 60_000) + 60;
await api.gql(`mutation($slug: String!, $minutes: String!) { updateAppointmentTypes(filter: { slug: { eq: $slug } }, data: { reminderMinutes: $minutes }) { id } }`, { slug: types.aliceIntro, minutes: `${firstReminder},60` });
await fetch(`${W}/s/scheduling/reminders-now`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: '{}' });
assert('reminders go out at the first due interval, once', (await inbox(gi)).filter((message) => /Reminder/.test(message.Subject)).length === 1);

// Public booking is rate limited per client and protected against instant bot posts.
const same = { 'x-forwarded-for': '10.99.99.99' };
const statuses = [];
for (let attempt = 0; attempt < 12; attempt += 1) statuses.push((await booking(W, { action: 'book', slug: types.aliceIntro, ticket: tickets[types.aliceIntro], start: 'not-a-date', customer: { name: 'x', email: 'x@x.test' } }, same)).status);
const freshTicket = (await booking(W, { action: 'page', slug: types.aliceIntro }, ip())).body.ticket;
const tooFast = await booking(W, { action: 'book', slug: types.aliceIntro, ticket: freshTicket, start: at(9, '15:00'), customer: { name: 'Bot', email: 'bot@bots.test' } }, ip());
const honeypot = await booking(W, { action: 'book', slug: types.aliceIntro, ticket: tickets[types.aliceIntro], website: 'http://spam.test', start: at(9, '15:00'), customer: { name: 'Bot', email: 'bot@bots.test' } }, ip());
assert('booking is limited per client, and instant or honeypot submissions are refused', statuses.slice(-2).every((status) => status === 429) && tooFast.status === 400 && honeypot.status === 400, `${statuses.join(',')} | too fast ${tooFast.status} | honeypot ${honeypot.status}`);

// 14. Workspace isolation.
if (otherKeyFile) {
  const other = keyClient(otherKeyFile);
  const seen = await other.gql(`{ appointments(first: 5) { totalCount } }`).then((data) => data.appointments.totalCount).catch((error) => `error: ${error.message.slice(0, 80)}`);
  const crossPage = await booking(W.replace('//acme.', '//glow.'), { action: 'page', slug: types.aliceIntro }, ip());
  assert('another workspace cannot see these appointments or book these pages', (seen === 0 || String(seen).startsWith('error')) && crossPage.status !== 200, `glow sees ${seen}; glow page status ${crossPage.status}`);
}

const errors = (await api.gql(`{ schedulingAuditEvents(filter: { name: { eq: "system.error" } }, first: 5) { edges { node { actor details } } } }`)).schedulingAuditEvents.edges;
assert('no unexpected server errors were recorded', errors.length === 0, errors.map((edge) => edge.node.details?.message).join(' | '));
process.exit(summary() ? 0 : 1);
