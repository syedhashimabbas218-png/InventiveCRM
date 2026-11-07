// Security regressions for the Scheduling app: each check tries an attack found in the 2026-11 review and expects it
// to be refused. Runs against the throwaway test world from setup.mjs, after e2e.mjs or on its own.
// Usage: SERVER_URL=http://localhost:3001 node security.mjs <state file> <api key file>
import { readFileSync } from 'node:fs';

import { admin, assert, booking, keyClient, mock, sleep, summary, userToken } from './lib.mjs';

const [stateFile, keyFile] = process.argv.slice(2);
const state = JSON.parse(readFileSync(stateFile, 'utf8'));
const W = state.workspaceUrl;
const OTHER = W.replace('//acme.', '//glow.');
const api = keyClient(keyFile);
const adminToken = await userToken(W, 'admin@inventiveweb.test', 'Admin-Pass-1234!');
const run = Date.now().toString(36);
let client = 0;
const ip = () => ({ 'x-forwarded-for': `10.77.${Math.floor(client / 250)}.${(client++ % 250) + 1}` });
const WEEK_AHEAD = new Date(Date.now() + 14 * 86_400_000);
const day = new Date(WEEK_AHEAD.getTime() + ((3 - WEEK_AHEAD.getUTCDay() + 7) % 7) * 86_400_000).toISOString().slice(0, 10);
const slots = async (body) => (await booking(W, { action: 'slots', from: `${day}T00:00:00.000Z`, days: 1, ...body }, ip())).body?.slots ?? [];

// 1. A map ticket issued in one workspace does not open another workspace's advisor map.
const { url: mapUrl } = (await admin(W, adminToken, { action: 'mapLink' })).body;
const ownMap = await fetch(mapUrl);
const crossMap = await fetch(mapUrl.replace('//acme.', '//glow.'));
const crossBody = await crossMap.text();
assert('a map ticket works in its own workspace and is refused in another', ownMap.status === 200 && !/advisors, \d+ offices/.test(crossBody) && crossMap.status !== 200, `own ${ownMap.status}, other ${crossMap.status}`);

// 2. A customer cannot pick an advisor the type does not offer. Bob is busy at 10:00; Alice's one-to-one type must
//    still offer 10:00 even when the request names Bob.
await mock('/admin/busy', { provider: 'microsoft', email: 'bob@outlook.test', title: 'Busy', start: `${day}T10:00:00.000Z`, end: `${day}T11:00:00.000Z` });
const plain = (await slots({ slug: state.types.aliceIntro })).map((slot) => slot.start);
const naming = (await slots({ slug: state.types.aliceIntro, advisorId: state.advisors.bob })).map((slot) => slot.start);
assert('naming another advisor in a slots request is ignored for a type that does not offer them', plain.includes(`${day}T10:00:00.000Z`) && JSON.stringify(plain) === JSON.stringify(naming), `${plain.length} vs ${naming.length} slots`);

// 3. Book once, then attack the booking.
const ticket = (await booking(W, { action: 'page', slug: state.types.aliceIntro }, ip())).body.ticket;
await sleep(3200);
const key = `security-${run}`;
const start = plain.find((slot) => slot !== `${day}T10:00:00.000Z`);
const booked = await booking(W, { action: 'book', slug: state.types.aliceIntro, ticket, start, customer: { name: 'Sec Customer', email: `sec.${run}@customers.test`, timeZone: 'Europe/London' }, answers: { topic: 'Pensions' }, idempotencyKey: key }, ip());
const token = booked.body?.manageUrl?.split('/booking/manage/')[1];
assert('a normal booking returns its manage link', booked.status === 200 && Boolean(token), JSON.stringify(booked.body).slice(0, 160));

// 3a. Replaying the idempotency key with different details does not hand out that customer's manage link.
const replay = await booking(W, { action: 'book', slug: state.types.aliceIntro, ticket, start, customer: { name: 'Mallory', email: `mallory.${run}@customers.test`, timeZone: 'Europe/London' }, answers: { topic: 'x' }, idempotencyKey: key }, ip());
assert("replaying someone's idempotency key does not return their manage link", !replay.body?.manageUrl && replay.status >= 400, `${replay.status} ${JSON.stringify(replay.body).slice(0, 120)}`);

// 3b. A manage link from this workspace is not valid in another workspace.
const crossManage = await booking(OTHER, { action: 'manage', token }, ip());
assert('a manage link is refused in another workspace', crossManage.status === 404, `${crossManage.status}`);

// 3c. A javascript: meeting link is never handed to the manage page.
const appointment = (await api.gql(`query($key: String!) { appointments(filter: { idempotencyKey: { eq: $key } }) { edges { node { id } } } }`, { key })).appointments.edges[0].node;
await api.gql(`mutation($id: UUID!) { updateAppointment(id: $id, data: { meetingUrl: "javascript:alert(document.cookie)" }) { id } }`, { id: appointment.id });
const managed = await booking(W, { action: 'manage', token }, ip());
assert('a javascript: meeting link is not passed to the manage page', managed.status === 200 && managed.body.meetingUrl === '', JSON.stringify(managed.body.meetingUrl));

// 3d. Once cancelled, the appointment cannot be cancelled or moved again through the link.
const cancelled = await booking(W, { action: 'cancel', token, reason: 'test' }, ip());
const again = await booking(W, { action: 'cancel', token, reason: 'again' }, ip());
const moved = await booking(W, { action: 'reschedule', token, start: plain[plain.length - 1] }, ip());
assert('a cancelled appointment cannot be cancelled again or moved', cancelled.status === 200 && again.status === 400 && moved.status === 400, `${cancelled.status}, again ${again.status}, move ${moved.status}`);

// 4. Contact matching treats LIKE wildcards literally: a "%" email never attaches to someone else's contact.
const ticket2 = (await booking(W, { action: 'page', slug: state.types.aliceIntro }, ip())).body.ticket;
await sleep(3200);
const wildcard = await booking(W, { action: 'book', slug: state.types.aliceIntro, ticket: ticket2, start: plain[plain.length - 1], customer: { name: 'Wild Card', email: `%@customers.test`, timeZone: 'Europe/London' }, answers: { topic: 'x' }, idempotencyKey: `wild-${run}` }, ip());
const wildPerson = wildcard.status === 200
  ? (await api.gql(`query { appointments(filter: { idempotencyKey: { eq: "wild-${run}" } }) { edges { node { person { emails { primaryEmail } } } } } }`)).appointments.edges[0]?.node.person?.emails.primaryEmail
  : null;
assert('a wildcard email is not matched to an existing contact', wildcard.status !== 200 || wildPerson === '%@customers.test', `${wildcard.status} ${wildPerson}`);

await mock('/admin/reset', {});
process.exit(summary() ? 0 : 1);
