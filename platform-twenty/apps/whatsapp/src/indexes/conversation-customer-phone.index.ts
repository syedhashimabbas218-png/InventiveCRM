import { defineIndex } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

// Opt-outs, consent changes and new conversations started from the CRM look conversations up by phone.
export default defineIndex({
  universalIdentifier: IDS.indexes.conversationCustomerPhone.index,
  objectUniversalIdentifier: IDS.conversation.object,
  fields: [{ universalIdentifier: IDS.indexes.conversationCustomerPhone.customerPhone, fieldUniversalIdentifier: IDS.conversation.fields.customerPhone }],
});
