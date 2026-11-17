import { defineIndex } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineIndex({
  universalIdentifier: IDS.recipientIndexes.batchKey.index,
  objectUniversalIdentifier: IDS.recipient.object,
  fields: [{ universalIdentifier: IDS.recipientIndexes.batchKey.field, fieldUniversalIdentifier: IDS.recipient.fields.batchKey }],
});
