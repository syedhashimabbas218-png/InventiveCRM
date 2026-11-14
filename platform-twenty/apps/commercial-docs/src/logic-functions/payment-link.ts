import { defineLogicFunction } from 'twenty-sdk/define';
import { jsonSchemaToInputSchema } from 'twenty-sdk/logic-function';

import { type DeliveryChannel } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { runAsApplication } from 'src/lib/api';
import { deliverDocument } from 'src/lib/delivery';
import { loadProfile } from 'src/lib/documents';
import { ensurePaymentLink } from 'src/lib/payments';

type Input = { invoiceId?: string; send?: boolean; channels?: DeliveryChannel[] };

const inputSchema = {
  type: 'object',
  properties: {
    invoiceId: { type: 'string', description: 'Id of an issued, part-paid or overdue invoice.' },
    send: { type: 'boolean', description: 'Also send the link to the client (WhatsApp and/or email).' },
    channels: { type: 'array', items: { type: 'string', enum: ['EMAIL', 'WHATSAPP'] as string[] }, description: "Defaults to the contact's preferred channel." },
  },
} as const;

const handler = async (event: Input & { body?: Input | null }) => {
  const input = event.body ?? event;
  if (!input.invoiceId) return { success: false, message: 'Give an invoiceId.' };
  const profile = await loadProfile();
  const provider = profile?.onlinePayments;
  if (!profile || (provider !== 'STRIPE' && provider !== 'REVOLUT')) return { success: false, message: 'Choose Stripe or Revolut under Online payments in the Business profile first.' };
  try {
    const url = await ensurePaymentLink(input.invoiceId, provider, profile.tradingName || profile.legalName || '');
    const deliveries = input.send ? await deliverDocument({ kind: 'invoice', id: input.invoiceId, profile, channels: input.channels, paymentLink: true }) : [];
    return { success: true, url, deliveries: deliveries.map((delivery) => `${delivery.channel}: ${delivery.status}${delivery.error ? ` (${delivery.error})` : ''}`) };
  } catch (error) {
    return { success: false, message: (error as Error).message };
  }
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.paymentLinkRoute,
  name: 'payment-link',
  description: 'Create (or refresh) the pay-now link for an invoice and optionally send it to the client by WhatsApp or email.',
  timeoutSeconds: 60,
  toolTriggerSettings: { inputSchema },
  workflowActionTriggerSettings: {
    label: 'Send pay-now link',
    icon: 'IconCreditCard',
    inputSchema: jsonSchemaToInputSchema(inputSchema),
    outputSchema: [{ type: 'object', properties: { success: { type: 'boolean' }, url: { type: 'string' } } }],
  },
  httpRouteTriggerSettings: { path: '/payments/link', httpMethod: 'POST', isAuthRequired: true },
  handler: runAsApplication(handler),
});
