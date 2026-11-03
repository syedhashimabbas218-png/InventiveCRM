// A member whose role cannot permanently delete records books and cancels in Twenty. The app's follow-up work (freeing
// the held time, calendar sync, emails) must still happen: it runs with the app's own access, not the member's.
// Usage: node restricted-role.mjs <state file from setup.mjs> <api key file>
import { readFileSync } from 'node:fs';

import { admin, apiClient, assert, keyClient, summary, userToken, waitFor } from './lib.mjs';

const [stateFile, keyFile] = process.argv.slice(2);
const state = JSON.parse(readFileSync(stateFile, 'utf8'));
const W = state.workspaceUrl;
const api = keyClient(keyFile);
const bobToken = await userToken(W, 'bob@inventiveweb.test', 'Bob-Pass-1234!');
const asBob = apiClient(bobToken, W);
const asAdmin = apiClient(await userToken(W, 'admin@inventiveweb.test', 'Admin-Pass-1234!'), W);
const startedAt = new Date().toISOString();
const ROLE = 'Edit without permanent delete (test)';

const { getRoles } = await asAdmin.metadata(`{ getRoles { id label workspaceMembers { id name { firstName } } } }`);
const memberRole = getRoles.find((role) => role.workspaceMembers.some((member) => member.name.firstName === 'Bob'));
const bobMemberId = memberRole.workspaceMembers.find((member) => member.name.firstName === 'Bob').id;
const restricted =
  getRoles.find((role) => role.label === ROLE) ??
  (
    await asAdmin.metadata(`mutation($input: CreateRoleInput!) { createOneRole(createRoleInput: $input) { id label } }`, {
      input: { label: ROLE, canReadAllObjectRecords: true, canUpdateAllObjectRecords: true, canSoftDeleteAllObjectRecords: true, canDestroyAllObjectRecords: false, canBeAssignedToUsers: true },
    })
  ).createOneRole;
const setBobRole = (roleId) => asAdmin.metadata(`mutation($member: UUID!, $role: UUID!) { updateWorkspaceMemberRole(workspaceMemberId: $member, roleId: $role) { id } }`, { member: bobMemberId, role: roleId });
const reservations = async (appointmentId) =>
  (await api.gql(`query($id: UUID!) { slotReservations(filter: { appointmentId: { eq: $id } }) { totalCount } }`, { id: appointmentId })).slotReservations.totalCount;

await setBobRole(restricted.id);
try {
  const type = (await api.gql(`query($slug: String!) { appointmentTypes(filter: { slug: { eq: $slug } }) { edges { node { id } } } }`, { slug: state.types.bobConsult })).appointmentTypes.edges[0].node;
  const booked = await admin(W, bobToken, { action: 'manualBook', appointmentTypeId: type.id, start: '2026-11-20T14:00:00.000Z', customer: { name: 'Role Customer', email: `role.${state.run}@customers.test` } });
  const appointmentId = booked.body?.appointmentId;
  assert('a member with the restricted role can book in Twenty', booked.status === 200 && Boolean(appointmentId), JSON.stringify(booked.body));
  const held = appointmentId ? await reservations(appointmentId) : 0;
  if (appointmentId) await asBob.gql(`mutation($id: UUID!) { updateAppointment(id: $id, data: { status: CANCELLED }) { id } }`, { id: appointmentId });
  const freed = appointmentId ? await waitFor('reservations released', async () => ((await reservations(appointmentId)) === 0 ? true : null), 30000).catch(() => false) : false;
  const errors = (await api.gql(`query($since: DateTime!) { schedulingAuditEvents(filter: { and: [{ name: { eq: "system.error" } }, { occurredAt: { gte: $since } }] }) { edges { node { details } } } }`, { since: startedAt })).schedulingAuditEvents.edges;
  assert('when that member cancels, the held time is freed and no app error is recorded', held > 0 && freed && errors.length === 0, `held ${held}, freed ${freed}, errors: ${errors.map((edge) => edge.node.details?.message).join(' | ').slice(0, 300)}`);
} finally {
  await setBobRole(memberRole.id);
}
summary();
