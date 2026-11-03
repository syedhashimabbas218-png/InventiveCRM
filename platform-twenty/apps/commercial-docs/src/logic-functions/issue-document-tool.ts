import { defineLogicFunction } from 'twenty-sdk/define';
import { jsonSchemaToInputSchema } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { gql } from 'src/lib/api';

type Input = { invoiceId?: string; quoteId?: string };

const inputSchema = {
  type: 'object',
  properties: {
    invoiceId: { type: 'string', description: 'Id of the invoice or credit note to issue.' },
    quoteId: { type: 'string', description: 'Id of the quote to send.' },
  },
} as const;

// Setting the status fires the same event handlers as the UI, so every route issues documents the same way.
const handler = async (input: Input) => {
  if (input.invoiceId)
    await gql(`mutation($id: UUID!) { updateInvoice(id: $id, data: { status: ISSUED }) { id } }`, { id: input.invoiceId });
  if (input.quoteId)
    await gql(`mutation($id: UUID!) { updateQuote(id: $id, data: { status: SENT }) { id } }`, { id: input.quoteId });
  return {
    success: Boolean(input.invoiceId || input.quoteId),
    message: 'Requested. The PDF is filed on the client card within a few seconds, or the record shows the issues to fix.',
  };
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.issueDocumentTool,
  name: 'issue-document',
  description: 'Issue an invoice or credit note, or send a quote: runs UK checks, numbers it, renders the PDF and files it on the client card.',
  timeoutSeconds: 30,
  toolTriggerSettings: { inputSchema },
  workflowActionTriggerSettings: {
    label: 'Issue invoice or send quote',
    icon: 'IconSend',
    inputSchema: jsonSchemaToInputSchema(inputSchema),
    outputSchema: [{ type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' } } }],
  },
  handler,
});
