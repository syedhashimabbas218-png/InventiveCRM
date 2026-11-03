import { type DatabaseEventPayload, defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { gql } from 'src/lib/api';
import { todayInLondon } from 'src/lib/dates';
import { issueInvoice } from 'src/lib/documents';

type StatusEvent = {
  recordId: string;
  properties: {
    before?: { status?: string | null };
    after?: { status?: string | null; total?: { amountMicros?: number | null } | null; amountPaid?: { amountMicros?: number | null } | null; paidDate?: string | null };
  };
};

const handler = async (payload: DatabaseEventPayload<StatusEvent>) => {
  const before = payload.properties.before?.status;
  const after = payload.properties.after;
  if (after?.status === 'ISSUED' && before !== 'ISSUED') {
    try {
      return await issueInvoice(payload.recordId);
    } catch (error) {
      // Surface failures on the record so the user sees why nothing happened.
      await gql(`mutation($id: UUID!, $data: InvoiceUpdateInput!) { updateInvoice(id: $id, data: $data) { id } }`, {
        id: payload.recordId,
        data: { status: before ?? 'DRAFT', complianceIssues: `Could not issue the invoice: ${(error as Error).message}` },
      });
      throw error;
    }
  }
  if (after?.status === 'PAID' && before !== 'PAID') {
    const data: Record<string, unknown> = {};
    if (!after.paidDate) data.paidDate = todayInLondon();
    if (!after.amountPaid?.amountMicros) data.amountPaid = { amountMicros: after.total?.amountMicros ?? 0, currencyCode: 'GBP' };
    if (Object.keys(data).length > 0)
      await gql(`mutation($id: UUID!, $data: InvoiceUpdateInput!) { updateInvoice(id: $id, data: $data) { id } }`, { id: payload.recordId, data });
  }
  return { ok: true };
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.onInvoiceStatusChange,
  name: 'on-invoice-status-change',
  description: 'Issuing an invoice runs the UK checks, numbers it, renders the PDF and files it on the client card. Paid records the payment date.',
  timeoutSeconds: 60,
  databaseEventTriggerSettings: { eventName: 'invoice.updated', updatedFields: ['status'] },
  handler,
});
