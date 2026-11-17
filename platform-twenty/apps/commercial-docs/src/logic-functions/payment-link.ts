import { defineLogicFunction } from 'twenty-sdk/define';
import { jsonSchemaToInputSchema } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { gql, isSignedInPerson, nodes, runAsApplication, TwentyUnavailableError } from 'src/lib/api';
import { deliverDocument, requestedChannels } from 'src/lib/delivery';
import { loadProfile } from 'src/lib/documents';
import { ensurePaymentLink } from 'src/lib/payments';

type Input = { invoiceId?: string; send?: boolean; channels?: unknown };

const inputSchema = {
  type: 'object',
  properties: {
    invoiceId: { type: 'string', description: 'Id of an issued, part-paid or overdue invoice.' },
    send: { type: 'boolean', description: 'Also send the link to the client (WhatsApp and/or email).' },
    channels: { type: 'array', items: { type: 'string', enum: ['EMAIL', 'WHATSAPP'] as string[] }, description: "Defaults to the contact's preferred channel." },
  },
} as const;

// Outside runAsApplication the token is the caller's own, so this answers whether their role lets them see the invoice.
const callerCanReadInvoice = async (invoiceId: string) => {
  try {
    const data = await gql<{ invoices: { edges: { node: { id: string } }[] } }>(`query($id: UUID!) { invoices(filter: { id: { eq: $id } }) { edges { node { id } } } }`, { id: invoiceId });
    return nodes(data.invoices).length > 0;
  } catch (error) {
    if (error instanceof TwentyUnavailableError) throw error;
    return false;
  }
};

const createAndSend = runAsApplication(async (invoiceId: string, input: Input) => {
  const channels = requestedChannels(input.channels);
  if (channels === null) return { success: false, message: 'channels can only be EMAIL and WHATSAPP.' };
  const profile = await loadProfile();
  const provider = profile?.onlinePayments;
  if (!profile || (provider !== 'STRIPE' && provider !== 'REVOLUT')) return { success: false, message: 'Choose Stripe or Revolut under Online payments in the Business profile first.' };
  try {
    const url = await ensurePaymentLink(invoiceId, provider, profile.tradingName || profile.legalName || '');
    const deliveries = input.send ? await deliverDocument({ kind: 'invoice', id: invoiceId, profile, channels, paymentLink: true }) : [];
    return { success: true, url, deliveries: deliveries.map((delivery) => `${delivery.channel}: ${delivery.status}${delivery.error ? ` (${delivery.error})` : ''}`) };
  } catch (error) {
    return { success: false, message: (error as Error).message };
  }
});

// Signed-in people are held to their own role; API keys, AI tools and workflows act with the app's role.
const handler = async (event: Input & { body?: Input | null; userWorkspaceId?: string | null }) => {
  const input = event.body ?? event;
  if (!input.invoiceId) return { success: false, message: 'Give an invoiceId.' };
  if (isSignedInPerson(event) && !(await callerCanReadInvoice(input.invoiceId))) return { success: false, message: 'Invoice not found.' };
  return createAndSend(input.invoiceId, input);
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
  handler,
});
