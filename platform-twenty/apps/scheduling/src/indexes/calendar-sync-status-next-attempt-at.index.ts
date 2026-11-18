import { defineIndex } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

const index = IDS.indexes.calendarSyncStatusNextAttemptAt;

// The sync job looks for due retries every 10 minutes.
export default defineIndex({
  universalIdentifier: index.index,
  objectUniversalIdentifier: IDS.calendarSync.object,
  fields: [
    { universalIdentifier: index.fields.status, fieldUniversalIdentifier: IDS.calendarSync.fields.status },
    { universalIdentifier: index.fields.nextAttemptAt, fieldUniversalIdentifier: IDS.calendarSync.fields.nextAttemptAt },
  ],
});
