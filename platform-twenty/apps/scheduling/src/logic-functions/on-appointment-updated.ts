import { type DatabaseEventPayload, defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { inBackground, onAppointmentUpdated } from 'src/lib/lifecycle';

type Snapshot = { status?: string | null; startsAt?: string | null; endsAt?: string | null; advisorId?: string | null };

const handler = (payload: DatabaseEventPayload<{ recordId: string; properties: { before?: Snapshot; after?: Snapshot } }>) =>
  inBackground('on-appointment-updated', () => onAppointmentUpdated(payload.recordId, payload.properties.before ?? {}, payload.properties.after ?? {}));

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.onAppointmentUpdated,
  name: 'on-appointment-updated',
  description: 'Applies cancellations, moves, reassignments and approvals: reservations, calendar events and emails.',
  timeoutSeconds: 120,
  databaseEventTriggerSettings: { eventName: 'appointment.updated', updatedFields: ['status', 'startsAt', 'endsAt', 'advisorId'] },
  handler,
});
