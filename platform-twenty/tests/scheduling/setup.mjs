// Creates the scheduling test world in one workspace and writes its ids to the state file:
// Alice (admin user, Google), Bob (second user, Microsoft), and Carol, Dan and Eve (no login, no calendar; they drive
// to customers from Headingley, Morley and York). Re-runnable: existing advisors are reused, types get a run suffix.
// Usage: node setup.mjs <workspace url> <api key file> <state file>
import { writeFileSync } from 'node:fs';

import { addMember, admin, connectCalendar, keyClient, memberId, userToken } from './lib.mjs';

const [workspaceUrl, keyFile, stateFile] = process.argv.slice(2);
const api = keyClient(keyFile);
const run = Date.now().toString(36);
const WEEK = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, [{ start: '09:00', end: '17:00' }]]));

const adminToken = await userToken(workspaceUrl, 'admin@inventiveweb.test', 'Admin-Pass-1234!');
const bobToken = await addMember(workspaceUrl, adminToken, 'bob@inventiveweb.test', 'Bob-Pass-1234!', 'Bob Outlook');

const one = async (query, variables) => Object.values(await api.gql(query, variables))[0];
const setupFor = async (token) => (await admin(workspaceUrl, token, { action: 'setupAdvisor' })).body.advisorId;
const alice = await setupFor(adminToken);
const bob = await setupFor(bobToken);
await api.gql(`mutation($id: UUID!, $data: AdvisorUpdateInput!) { updateAdvisor(id: $id, data: $data) { id } }`, { id: alice, data: { name: 'Alice Google', email: 'alice@inventiveweb.test' } });
await api.gql(`mutation($id: UUID!, $data: AdvisorUpdateInput!) { updateAdvisor(id: $id, data: $data) { id } }`, { id: bob, data: { name: 'Bob Outlook', email: 'bob@inventiveweb.test' } });
for (const id of [alice, bob]) {
  const advisor = (await api.gql(`query($id: UUID!) { advisors(filter: { id: { eq: $id } }) { edges { node { scheduleId } } } }`, { id })).advisors.edges[0].node;
  await api.gql(`mutation($id: UUID!, $data: AvailabilityScheduleUpdateInput!) { updateAvailabilitySchedule(id: $id, data: $data) { id } }`, { id: advisor.scheduleId, data: { weeklyHours: WEEK, timeZone: 'Europe/London' } });
}

const applicationId = (await admin(workspaceUrl, adminToken, { action: 'connections' })).body.applicationId;
const existingConnections = (token) => admin(workspaceUrl, token, { action: 'connections' }).then((result) => result.body.connections);
if ((await existingConnections(adminToken)).length === 0)
  await connectCalendar({ token: adminToken, workspaceUrl, applicationId, providerName: 'google-calendar', provider: 'google', email: 'alice@googlemail.test' });
if ((await existingConnections(bobToken)).length === 0)
  await connectCalendar({ token: bobToken, workspaceUrl, applicationId, providerName: 'microsoft-calendar', provider: 'microsoft', email: 'bob@outlook.test' });

const findOrCreateAdvisor = async (name, data) => {
  const found = (await api.gql(`query($name: String!) { advisors(filter: { name: { eq: $name } }) { edges { node { id } } } }`, { name })).advisors.edges[0]?.node.id;
  if (found) return found;
  const id = (await one(`mutation($data: AdvisorCreateInput!) { createAdvisor(data: $data) { id } }`, { data: { name, isActive: true, timeZone: 'Europe/London', ...data } })).id;
  const schedule = (await one(`mutation($data: AvailabilityScheduleCreateInput!) { createAvailabilitySchedule(data: $data) { id } }`, { data: { name: `${name}: hours`, timeZone: 'Europe/London', weeklyHours: WEEK, isDefault: true, ownerId: id } })).id;
  await api.gql(`mutation($id: UUID!, $data: AdvisorUpdateInput!) { updateAdvisor(id: $id, data: $data) { id } }`, { id, data: { scheduleId: schedule } });
  return id;
};
const mobile = { travelsToCustomers: true, inPerson: true, remote: false, serviceRadiusKm: 12, travelBufferMinutes: 5 };
const carol = await findOrCreateAdvisor('Carol Headingley', { ...mobile, email: 'carol@inventiveweb.test', baseLatitude: 53.8188, baseLongitude: -1.5784, publicLocationLabel: 'North Leeds', postcodeTerritory: 'LS6, LS16, LS4' });
const dan = await findOrCreateAdvisor('Dan Morley', { ...mobile, email: 'dan@inventiveweb.test', baseLatitude: 53.74, baseLongitude: -1.6, publicLocationLabel: 'South Leeds', postcodeTerritory: 'LS27, LS11' });
const eve = await findOrCreateAdvisor('Eve York', { ...mobile, email: 'eve@inventiveweb.test', baseLatitude: 53.959, baseLongitude: -1.0815, publicLocationLabel: 'York', serviceRadiusKm: 15, postcodeTerritory: 'YO' });

const office = (await one(`mutation($data: OfficeCreateInput!) { createOffice(data: $data) { id } }`, {
  data: { name: `Leeds City Office ${run}`, streetAddress: '12 Park Row, Leeds', postcode: 'LS1 5HD', latitude: 53.7965, longitude: -1.5472, timeZone: 'Europe/London', isPublic: true },
})).id;
const team = async (name, members) => {
  const id = (await one(`mutation($data: SchedulingTeamCreateInput!) { createSchedulingTeam(data: $data) { id } }`, { data: { name: `${name} ${run}`, slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${run}`, isActive: true, fairnessWindowDays: 30 } })).id;
  await api.gql(`mutation($data: [TeamMembershipCreateInput!]!) { createTeamMemberships(data: $data) { id } }`, {
    data: members.map((advisorId) => ({ name: advisorId, teamId: id, advisorId, isActive: true, weight: 1 })),
  });
  return id;
};
const advisorsTeam = await team('Advisors', [alice, bob, carol]);
const pairTeam = await team('Pair', [alice, bob]);
const mobileTeam = await team('Mobile', [carol, dan, eve]);

const base = { status: 'ACTIVE', durationMinutes: 30, incrementMinutes: 30, minimumNoticeMinutes: 60, horizonDays: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, timeZone: 'Europe/London', reminderMinutes: '1440,60', cancellationCutoffHours: 2, rescheduleCutoffHours: 2 };
const type = async (key, data) => {
  const slug = `${key}-${run}`;
  await one(`mutation($data: AppointmentTypeCreateInput!) { createAppointmentType(data: $data) { id } }`, { data: { ...base, name: data.name, slug, ...data } });
  return slug;
};
const types = {
  aliceIntro: await type('intro-alice', { name: 'Intro call with Alice', assignment: 'ONE_TO_ONE', ownerId: alice, meetingFormat: 'VIRTUAL', conferencing: 'GOOGLE_MEET', intakeQuestions: [{ id: 'topic', label: 'What would you like to discuss?', type: 'text', required: true }] }),
  bobConsult: await type('consult-bob', { name: 'Consultation with Bob', assignment: 'ONE_TO_ONE', ownerId: bob, meetingFormat: 'VIRTUAL', conferencing: 'MICROSOFT_TEAMS' }),
  roundRobin: await type('team-consultation', { name: 'Team consultation', assignment: 'ROUND_ROBIN', roundRobinStrategy: 'EQUAL', teamId: advisorsTeam, meetingFormat: 'PHONE' }),
  collective: await type('joint-review', { name: 'Joint review', assignment: 'COLLECTIVE', teamId: pairTeam, ownerId: alice, meetingFormat: 'VIRTUAL', conferencing: 'GOOGLE_MEET' }),
  group: await type('workshop', { name: 'Group workshop', assignment: 'ONE_TO_ONE', ownerId: alice, meetingFormat: 'VIRTUAL', capacity: 3, durationMinutes: 60, incrementMinutes: 60 }),
  office: await type('office-visit', { name: 'Office visit', assignment: 'ROUND_ROBIN', teamId: pairTeam, meetingFormat: 'IN_PERSON_OFFICE', officeId: office }),
  nearest: await type('nearest-advisor', { name: 'Home visit (nearest advisor)', assignment: 'ROUND_ROBIN', teamId: mobileTeam, meetingFormat: 'AT_CUSTOMER', locationMode: 'NEAREST', distanceBasis: 'ROAD', durationMinutes: 60, incrementMinutes: 60 }),
  choose: await type('choose-nearby', { name: 'Home visit (choose your advisor)', assignment: 'CUSTOMER_CHOICE', teamId: mobileTeam, meetingFormat: 'AT_CUSTOMER', locationMode: 'CUSTOMER_CHOICE', durationMinutes: 60, incrementMinutes: 60 }),
  territory: await type('territory', { name: 'Territory visit', assignment: 'ROUND_ROBIN', teamId: mobileTeam, meetingFormat: 'AT_CUSTOMER', locationMode: 'TERRITORY', durationMinutes: 60, incrementMinutes: 60 }),
};

const state = { run, workspaceUrl, applicationId, advisors: { alice, bob, carol, dan, eve }, members: { bob: await memberId(bobToken, workspaceUrl) }, office, teams: { advisorsTeam, pairTeam, mobileTeam }, types };
writeFileSync(stateFile, JSON.stringify(state, null, 2));
console.log(JSON.stringify(state, null, 2));
