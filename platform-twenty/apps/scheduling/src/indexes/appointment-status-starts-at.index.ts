import { defineIndex } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

const index = IDS.indexes.appointmentStatusStartsAt;

// Reminders and housekeeping look for open appointments by start time.
export default defineIndex({
  universalIdentifier: index.index,
  objectUniversalIdentifier: IDS.appointment.object,
  fields: [
    { universalIdentifier: index.fields.status, fieldUniversalIdentifier: IDS.appointment.fields.status },
    { universalIdentifier: index.fields.startsAt, fieldUniversalIdentifier: IDS.appointment.fields.startsAt },
  ],
});
