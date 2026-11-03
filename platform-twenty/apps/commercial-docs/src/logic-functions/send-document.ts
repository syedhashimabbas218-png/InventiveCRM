import { defineLogicFunction } from 'twenty-sdk/define';
import { jsonSchemaToInputSchema } from 'twenty-sdk/logic-function';

import { type DeliveryChannel } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { deliverDocument } from 'src/lib/delivery';
import { loadProfile } from 'src/lib/documents';

type Input = { invoiceId?: string; quoteId?: string; channels?: DeliveryChannel[]; reminder?: boolean };

const inputSchema = {
  type: 'object',
  properties: {
    invoiceId: { type: 'string', description: 'Id of an issued invoice or credit note to send.' },
    quoteId: { type: 'string', description: 'Id of a sent quote to send again.' },
    channels: {
      type: 'array',
      items: { type: 'string', enum: ['EMAIL', 'WHATSAPP'] as string[] },
      description: "Channels to use. Defaults to the contact's preferred channel.",
    },
    reminder: { type: 'boolean', description: 'Send an overdue payment reminder instead of the invoice email.' },
  },
} as const;

const handler = async (event: Input & { body?: Input | null }) => {
  const input = event.body ?? event;
  const kind = input.invoiceId ? 'invoice' : input.quoteId ? 'quote' : null;
  const id = input.invoiceId || input.quoteId;
  if (!kind || !id) return { success: false, message: 'Give an invoiceId or a quoteId.', deliveries: [] };
  const profile = await loadProfile();
  if (!profile) return { success: false, message: 'Create a Business profile first.', deliveries: [] };
  const deliveries = await deliverDocument({ kind, id, profile, channels: input.channels, reminder: input.reminder === true });
  if (deliveries.length === 0)
    return { success: false, message: 'Only issued invoices and sent quotes can be sent.', deliveries };
  return {
    success: deliveries.every((delivery) => delivery.status === 'SENT'),
    message: deliveries.map((delivery) => `${delivery.channel}: ${delivery.status}${delivery.error ? ` (${delivery.error})` : ''}`).join('; '),
    deliveries,
  };
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.sendDocumentTool,
  name: 'send-document',
  description:
    'Send an issued invoice, credit note or quote to the client by email or WhatsApp with the PDF, or send an overdue reminder. Each attempt is logged as a Delivery.',
  timeoutSeconds: 60,
  toolTriggerSettings: { inputSchema },
  workflowActionTriggerSettings: {
    label: 'Send invoice or quote',
    icon: 'IconMailForward',
    inputSchema: jsonSchemaToInputSchema(inputSchema),
    outputSchema: [{ type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' } } }],
  },
  httpRouteTriggerSettings: { path: '/documents/send', httpMethod: 'POST', isAuthRequired: true },
  handler,
});
