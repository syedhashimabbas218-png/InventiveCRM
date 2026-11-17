import { defineIndex } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

const index = IDS.indexes.invoiceStatusDueDate;

// The daily run looks for unpaid invoices past their due date.
export default defineIndex({
  universalIdentifier: index.index,
  objectUniversalIdentifier: IDS.invoice.object,
  fields: [
    { universalIdentifier: index.status, fieldUniversalIdentifier: IDS.invoice.fields.status },
    { universalIdentifier: index.dueDate, fieldUniversalIdentifier: IDS.invoice.fields.dueDate },
  ],
});
