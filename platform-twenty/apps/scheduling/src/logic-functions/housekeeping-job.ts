import { defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { DAY, MINUTE } from 'src/engine/time';
import { gql, nodes } from 'src/lib/api';
import { inBackground } from 'src/lib/lifecycle';
import { purgeOldCounters } from 'src/lib/rate-limit';

// A booking links its held time to the record within seconds; unlinked time older than this was left by one that died.
const ORPHAN_MINUTES = 15;

const destroyReservations = async (filter: Record<string, unknown>) =>
  (await gql<{ destroySlotReservations: { id: string }[] }>(`mutation($filter: SlotReservationFilterInput!) { destroySlotReservations(filter: $filter) { id } }`, { filter }))
    .destroySlotReservations.length;

// Appointments still open a day after they ended are marked Completed; advisors can change one to No-show.
const run = async () => {
  const now = Date.now();
  await purgeOldCounters(now - 2 * DAY);
  const data = await gql<{ appointments: { edges: { node: { id: string } }[] } }>(
    `query($before: DateTime!) { appointments(filter: { status: { in: [CONFIRMED, RESCHEDULED] }, endsAt: { lt: $before } }, first: 500) { edges { node { id } } } }`,
    { before: new Date(now - DAY).toISOString() },
  );
  for (const appointment of nodes(data.appointments))
    await gql(`mutation($id: UUID!) { updateAppointment(id: $id, data: { status: COMPLETED }) { id } }`, { id: appointment.id });
  const orphanedReservations = await destroyReservations({ appointmentId: { is: 'NULL' }, createdAt: { lt: new Date(now - ORPHAN_MINUTES * MINUTE).toISOString() } });
  const cancelledReservations = await destroyReservations({ appointment: { status: { eq: 'CANCELLED' } } });
  return { completed: nodes(data.appointments).length, orphanedReservations, cancelledReservations };
};

const handler = () => inBackground('housekeeping-job', run);

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.housekeepingJob,
  name: 'scheduling-housekeeping',
  description: 'Clears old rate-limit counters, completes appointments that have ended and frees time left held by failed bookings or cancelled appointments.',
  timeoutSeconds: 300,
  cronTriggerSettings: { pattern: '23 3 * * *' },
  handler,
});
