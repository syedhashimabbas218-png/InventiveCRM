import { defineIndex } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

const index = IDS.indexes.calendarSyncName;

// Every calendar sync finds its outbox rows by name.
export default defineIndex({
  universalIdentifier: index.index,
  objectUniversalIdentifier: IDS.calendarSync.object,
  fields: [{ universalIdentifier: index.fields.name, fieldUniversalIdentifier: IDS.calendarSync.fields.name }],
});
