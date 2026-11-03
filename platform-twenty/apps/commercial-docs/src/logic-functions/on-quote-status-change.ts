import { type DatabaseEventPayload, defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { convertQuoteToInvoice, sendQuote } from 'src/lib/documents';

type StatusEvent = { recordId: string; properties: { before?: { status?: string | null }; after?: { status?: string | null } } };

const handler = async (payload: DatabaseEventPayload<StatusEvent>) => {
  const before = payload.properties.before?.status;
  const after = payload.properties.after?.status;
  if (after === 'SENT' && before !== 'SENT') return sendQuote(payload.recordId);
  if (after === 'ACCEPTED' && before !== 'ACCEPTED') return convertQuoteToInvoice(payload.recordId);
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
