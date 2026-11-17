import { defineIndex } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

const index = IDS.indexes.invoicePaymentCheck;

// Every 10 minutes the reconcile run reads open pay-now links, least recently checked first.
export default defineIndex({
  universalIdentifier: index.index,
  objectUniversalIdentifier: IDS.invoice.object,
  fields: [
    { universalIdentifier: index.paymentLinkStatus, fieldUniversalIdentifier: IDS.invoice.fields.paymentLinkStatus },
    { universalIdentifier: index.paymentCheckedAt, fieldUniversalIdentifier: IDS.invoice.fields.paymentCheckedAt },
  ],
});
