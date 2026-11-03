import { defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { DAY } from 'src/engine/time';
import { gql, nodes } from 'src/lib/api';
import { purgeOldCounters } from 'src/lib/rate-limit';

// Appointments still open a day after they ended are marked Completed; advisors can change one to No-show.
const handler = async () => {
  const now = Date.now();
  await purgeOldCounters(now - 2 * DAY);
  const data = await gql<{ appointments: { edges: { node: { id: string } }[] } }>(
    `query($before: DateTime!) { appointments(filter: { status: { in: [CONFIRMED, RESCHEDULED] }, endsAt: { lt: $before } }, first: 500) { edges { node { id } } } }`,
    { before: new Date(now - DAY).toISOString() },
  );
  for (const appointment of nodes(data.appointments))
    await gql(`mutation($id: UUID!) { updateAppointment(id: $id, data: { status: COMPLETED }) { id } }`, { id: appointment.id });
  return { completed: nodes(data.appointments).length };
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.housekeepingJob,
  name: 'scheduling-housekeeping',
  description: 'Clears old rate-limit counters and completes appointments that have ended.',
  timeoutSeconds: 300,
  cronTriggerSettings: { pattern: '23 3 * * *' },
  handler,
});
