import { type DatabaseEventPayload, defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { gql } from 'src/lib/api';
import { convertQuoteToInvoice, sendQuote } from 'src/lib/documents';

type StatusEvent = { recordId: string; properties: { before?: { status?: string | null }; after?: { status?: string | null } } };

const handler = async (payload: DatabaseEventPayload<StatusEvent>) => {
  const before = payload.properties.before?.status;
  const after = payload.properties.after?.status;
  try {
    if (after === 'SENT' && before !== 'SENT') return await sendQuote(payload.recordId);
    if (after === 'ACCEPTED' && before !== 'ACCEPTED') return await convertQuoteToInvoice(payload.recordId);
  } catch (error) {
    // Surface failures on the record so the user sees why nothing happened.
    await gql(`mutation($id: UUID!, $data: QuoteUpdateInput!) { updateQuote(id: $id, data: $data) { id } }`, {
      id: payload.recordId,
      data: { status: before ?? 'DRAFT', complianceIssues: `Could not process the quote: ${(error as Error).message}` },
    });
    throw error;
  }
  return { ok: true };
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.onQuoteStatusChange,
  name: 'on-quote-status-change',
  description: 'Sending a quote numbers it and files the PDF on the client card. Accepting it creates a draft invoice with the same lines.',
  timeoutSeconds: 60,
  databaseEventTriggerSettings: { eventName: 'quote.updated', updatedFields: ['status'] },
  handler,
});
