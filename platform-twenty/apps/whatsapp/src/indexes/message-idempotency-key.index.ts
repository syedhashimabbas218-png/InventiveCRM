import { defineIndex } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

// message.sent webhooks are matched to the record that sent them by this key until the InventiveChat id is stored.
export default defineIndex({
  universalIdentifier: IDS.indexes.messageIdempotencyKey.index,
  objectUniversalIdentifier: IDS.message.object,
  fields: [{ universalIdentifier: IDS.indexes.messageIdempotencyKey.idempotencyKey, fieldUniversalIdentifier: IDS.message.fields.idempotencyKey }],
});
