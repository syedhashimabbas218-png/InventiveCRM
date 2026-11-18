import { defineIndex } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

// A campaign batch sent again after a timeout is answered from the messages it already produced.
export default defineIndex({
  universalIdentifier: IDS.indexes.messageBatchId.index,
  objectUniversalIdentifier: IDS.message.object,
  fields: [{ universalIdentifier: IDS.indexes.messageBatchId.batchId, fieldUniversalIdentifier: IDS.message.fields.batchId }],
});
