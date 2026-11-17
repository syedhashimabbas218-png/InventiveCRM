import { defineIndex } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

// Resend sends the whole account's events to the webhook; most are not campaign emails and miss this lookup.
export default defineIndex({
  universalIdentifier: IDS.recipientIndexes.providerMessageId.index,
  objectUniversalIdentifier: IDS.recipient.object,
  fields: [{ universalIdentifier: IDS.recipientIndexes.providerMessageId.field, fieldUniversalIdentifier: IDS.recipient.fields.providerMessageId }],
});
