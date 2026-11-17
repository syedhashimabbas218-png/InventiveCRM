import { type DatabaseEventPayload, defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { inBackground, onAppointmentDeleted } from 'src/lib/lifecycle';

const handler = (payload: DatabaseEventPayload<{ recordId: string }>) => inBackground('on-appointment-deleted', () => onAppointmentDeleted(payload.recordId));

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.onAppointmentDeleted,
  name: 'on-appointment-deleted',
  description: 'Frees the time of deleted appointments and removes their calendar events.',
  timeoutSeconds: 120,
  databaseEventTriggerSettings: { eventName: 'appointment.deleted' },
  handler,
});
