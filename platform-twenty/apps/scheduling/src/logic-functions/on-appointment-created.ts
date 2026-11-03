import { type DatabaseEventPayload, defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { inBackground, onAppointmentCreated } from 'src/lib/lifecycle';

const handler = (payload: DatabaseEventPayload<{ recordId: string }>) => inBackground('on-appointment-created', () => onAppointmentCreated(payload.recordId));

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.onAppointmentCreated,
  name: 'on-appointment-created',
  description: 'Claims the time of appointments added in the CRM, writes the calendar events and sends the confirmations.',
  timeoutSeconds: 120,
  databaseEventTriggerSettings: { eventName: 'appointment.created' },
  handler,
});
