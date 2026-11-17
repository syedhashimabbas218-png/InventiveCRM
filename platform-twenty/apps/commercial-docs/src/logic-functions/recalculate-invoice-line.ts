import { type DatabaseEventPayload, defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { runAsApplication } from 'src/lib/api';
import { refreshLine } from 'src/lib/documents';

type LineEvent = { recordId: string; properties: { before?: { invoiceId?: string | null }; after?: { invoiceId?: string | null } } };

// Updates run only when one of these changes, so this function's own netAmount and vatAmount writes start no
// further round. Created, deleted and restored lines always run.
const TOTALS_FIELDS = ['quantity', 'unitPrice', 'discountPercent', 'vatRate', 'product', 'productId', 'invoice', 'invoiceId'];

const handler = async (payload: DatabaseEventPayload<LineEvent>) => {
  const parentHint = payload.properties.after?.invoiceId ?? payload.properties.before?.invoiceId ?? null;
  await refreshLine('invoiceLine', payload.recordId, parentHint);
  if (payload.properties.before?.invoiceId && payload.properties.before.invoiceId !== parentHint)
    await refreshLine('invoiceLine', payload.recordId, payload.properties.before.invoiceId);
  return { ok: true };
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.recalculateInvoiceLine,
  name: 'recalculate-invoice-line',
  description: 'Fills invoice lines from the price list and keeps line and invoice totals up to date.',
  timeoutSeconds: 30,
  databaseEventTriggerSettings: { eventName: 'invoiceLine.*', updatedFields: TOTALS_FIELDS },
  handler: runAsApplication(handler),
});
