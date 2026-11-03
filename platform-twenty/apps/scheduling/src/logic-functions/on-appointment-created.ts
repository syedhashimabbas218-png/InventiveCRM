import { type DatabaseEventPayload, defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { onAppointmentCreated } from 'src/lib/lifecycle';

const handler = async (payload: DatabaseEventPayload<{ recordId: string }>) => onAppointmentCreated(payload.recordId);

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.onAppointmentCreated,
  name: 'on-appointment-created',
  description: 'Claims the time of appointments added in the CRM, writes the calendar events and sends the confirmations.',
  timeoutSeconds: 120,
  databaseEventTriggerSettings: { eventName: 'appointment.created' },
  handler,
});
