import { defineIndex } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

// The retry job looks for queued messages whose wait is over, every few minutes.
export default defineIndex({
  universalIdentifier: IDS.indexes.messageRetry.index,
  objectUniversalIdentifier: IDS.message.object,
  fields: [
    { universalIdentifier: IDS.indexes.messageRetry.status, fieldUniversalIdentifier: IDS.message.fields.status },
    { universalIdentifier: IDS.indexes.messageRetry.retryAt, fieldUniversalIdentifier: IDS.message.fields.retryAt },
  ],
});
