import { createHash } from 'node:crypto';

import { listConnections } from 'twenty-sdk/logic-function';

import { type PaymentProvider } from 'src/constants/enums';
import { gql, nodes } from 'src/lib/api';
import { todayInLondon } from 'src/lib/dates';
import { gbp, microsToPence } from 'src/lib/money';

// Each client connects their own Stripe or Revolut account; the secret key is stored encrypted by Twenty as the
// connection's token and only read here, on the server, when a link is created or checked.
export const PAYMENT_CONNECTION_NAMES: Record<Exclude<PaymentProvider, 'NONE'>, string> = { STRIPE: 'stripe-account', REVOLUT: 'revolut-account' };

const stripeBase = () => (process.env.STRIPE_API_URL || 'https://api.stripe.com').replace(/\/$/, '');
const revolutBase = () => (process.env.REVOLUT_API_URL || 'https://merchant.revolut.com').replace(/\/$/, '');
const REVOLUT_API_VERSION = '2026-04-20';

export class PaymentError extends Error {}

const keyFingerprint = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 16);

// Whether the key with this fingerprint (computed by the person who has the key) is stored and working.
export const isKeyConnected = async (provider: Exclude<PaymentProvider, 'NONE'>, fingerprint: string) =>
  (await listConnections({ providerName: PAYMENT_CONNECTION_NAMES[provider], scope: 'WORKSPACE' }).catch(() => [])).some(
    (connection) => connection.externalAccountId === `${provider.toLowerCase()}-${fingerprint}` && connection.accessToken && !connection.authFailedAt,
  );

export const paymentKey = async (provider: Exclude<PaymentProvider, 'NONE'>) => {
  const connections = (await listConnections({ providerName: PAYMENT_CONNECTION_NAMES[provider], scope: 'WORKSPACE' }).catch(() => [])).filter((connection) => connection.accessToken && !connection.authFailedAt);
  const newest = connections[connections.length - 1];
  if (!newest?.accessToken) throw new PaymentError(`No ${provider === 'STRIPE' ? 'Stripe' : 'Revolut'} account is connected. Connect one under Settings, Accounts.`);
  return newest.accessToken;
};

// Stripe's API takes form-encoded bodies with bracketed keys for nested objects.
export const formEncode = (value: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(value).flatMap(([key, entry]) => {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (entry === undefined || entry === null) return [];
    if (typeof entry === 'object') return formEncode(entry as Record<string, unknown>, name);
    return [`${encodeURIComponent(name)}=${encodeURIComponent(String(entry))}`];
  });

const stripe = async <TResult>(key: string, method: 'GET' | 'POST', path: string, body?: Record<string, unknown>, idempotencyKey?: string) => {
  const response = await fetch(`${stripeBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body ? formEncode(body).join('&') : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await response.json().catch(() => ({}))) as TResult & { error?: { message?: string } };
  if (!response.ok) throw new PaymentError(`Stripe answered ${response.status}: ${data.error?.message ?? 'request failed'}`);
  return data;
};

const revolut = async <TResult>(key: string, method: 'GET' | 'POST', path: string, body?: Record<string, unknown>) => {
  const response = await fetch(`${revolutBase()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Revolut-Api-Version': REVOLUT_API_VERSION, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await response.json().catch(() => ({}))) as TResult & { message?: string };
  if (!response.ok) throw new PaymentError(`Revolut answered ${response.status}: ${data.message ?? 'request failed'}`);
  return data;
};

export const validatePaymentKey = async (provider: Exclude<PaymentProvider, 'NONE'>, key: string) => {
  if (provider === 'STRIPE') {
    if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/.test(key)) throw new PaymentError('That does not look like a Stripe secret or restricted key (sk_… or rk_…).');
    await stripe(key, 'GET', '/v1/payment_links?limit=1');
  } else {
    if (!/^[A-Za-z0-9_-]{20,}$/.test(key)) throw new PaymentError('That does not look like a Revolut Merchant API secret key.');
    await revolut(key, 'GET', '/api/orders?limit=1');
  }
  return { mode: key.includes('_test_') || key.includes('sandbox') ? 'test' : 'live', fingerprint: keyFingerprint(key) };
};

type InvoiceForPayment = {
  id: string;
  invoiceNumber: string;
  kind: string | null;
  status: string;
  total: { amountMicros: number | string | null } | null;
  amountPaid: { amountMicros: number | string | null } | null;
  paymentProvider: PaymentProvider | null;
  paymentLinkUrl: string;
  paymentReference: string;
  paymentLinkStatus: string | null;
  paymentLinkAmountPence: number | null;
};

const INVOICE_FIELDS = 'id invoiceNumber kind status total { amountMicros } amountPaid { amountMicros } paymentProvider paymentLinkUrl paymentReference paymentLinkStatus paymentLinkAmountPence';

const loadInvoice = async (id: string) =>
  nodes((await gql<{ invoices: { edges: { node: InvoiceForPayment }[] } }>(`query($id: UUID!) { invoices(filter: { id: { eq: $id } }) { edges { node { ${INVOICE_FIELDS} } } } }`, { id })).invoices)[0] ?? null;

const updateInvoice = (id: string, data: Record<string, unknown>) =>
  gql(`mutation($id: UUID!, $data: InvoiceUpdateInput!) { updateInvoice(id: $id, data: $data) { id } }`, { id, data });

// Always what is still owed, never more: part payments already recorded are taken off.
export const outstandingPence = (invoice: Pick<InvoiceForPayment, 'total' | 'amountPaid'>) => Math.max(0, microsToPence(invoice.total?.amountMicros) - microsToPence(invoice.amountPaid?.amountMicros));

const PAYABLE_STATUSES = ['ISSUED', 'PART_PAID', 'OVERDUE'];

const closeLink = async (invoice: InvoiceForPayment) => {
  if (!invoice.paymentReference || invoice.paymentLinkStatus !== 'OPEN') return;
  try {
    if (invoice.paymentProvider === 'STRIPE') await stripe(await paymentKey('STRIPE'), 'POST', `/v1/payment_links/${encodeURIComponent(invoice.paymentReference)}`, { active: false });
    if (invoice.paymentProvider === 'REVOLUT') await revolut(await paymentKey('REVOLUT'), 'POST', `/api/orders/${encodeURIComponent(invoice.paymentReference)}/cancel`);
  } catch {
    // A link that cannot be closed (already paid, already cancelled) is still marked closed here.
  }
};

// Creates a pay-now link for what is owed, or keeps the open one if the amount has not changed.
export const ensurePaymentLink = async (invoiceId: string, provider: Exclude<PaymentProvider, 'NONE'>, businessName: string) => {
  const invoice = await loadInvoice(invoiceId);
  if (!invoice) throw new PaymentError('Invoice not found.');
  if (invoice.kind === 'CREDIT_NOTE') throw new PaymentError('Credit notes are not paid online.');
  if (!PAYABLE_STATUSES.includes(invoice.status)) throw new PaymentError('Only issued, part-paid or overdue invoices can be paid online.');
  const amount = outstandingPence(invoice);
  if (amount <= 0) throw new PaymentError('Nothing is owed on this invoice.');
  if (invoice.paymentLinkStatus === 'OPEN' && invoice.paymentProvider === provider && invoice.paymentLinkAmountPence === amount && invoice.paymentLinkUrl) return invoice.paymentLinkUrl;
  await closeLink(invoice);

  const key = await paymentKey(provider);
  const description = `Invoice ${invoice.invoiceNumber}${businessName ? ` from ${businessName}` : ''}`;
  try {
    let url: string;
    let reference: string;
    if (provider === 'STRIPE') {
      const link = await stripe<{ id: string; url: string }>(
        key,
        'POST',
        '/v1/payment_links',
        {
          line_items: { 0: { price_data: { currency: 'gbp', unit_amount: amount, product_data: { name: description } }, quantity: 1 } },
          restrictions: { completed_sessions: { limit: 1 } },
          metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber },
          after_completion: { type: 'hosted_confirmation', hosted_confirmation: { custom_message: `Thank you. Your payment for invoice ${invoice.invoiceNumber} has been received.` } },
        },
        `invoice-${invoice.id}-${amount}`,
      );
      url = link.url;
      reference = link.id;
    } else {
      const order = await revolut<{ id: string; checkout_url: string }>(key, 'POST', '/api/orders', {
        amount,
        currency: 'GBP',
        description,
        merchant_order_data: { reference: invoice.invoiceNumber },
        metadata: { invoiceId: invoice.id },
      });
      url = order.checkout_url;
      reference = order.id;
    }
    if (!/^https:\/\//.test(url)) throw new PaymentError('The payment provider did not return a secure link.');
    await updateInvoice(invoice.id, {
      paymentProvider: provider,
      paymentLinkUrl: url,
      paymentReference: reference,
      paymentLinkStatus: 'OPEN',
      paymentLinkAmountPence: amount,
      paymentLinkCreatedAt: new Date().toISOString(),
    });
    return url;
  } catch (error) {
    await updateInvoice(invoice.id, { paymentLinkStatus: 'FAILED', paymentLinkUrl: '', paymentReference: '' });
    throw error;
  }
};

const paidAmount = async (invoice: InvoiceForPayment): Promise<number | null> => {
  if (invoice.paymentProvider === 'STRIPE') {
    const sessions = await stripe<{ data: { payment_status: string; amount_total: number | null }[] }>(
      await paymentKey('STRIPE'),
      'GET',
      `/v1/checkout/sessions?payment_link=${encodeURIComponent(invoice.paymentReference)}&status=complete&limit=1`,
    );
    const paid = sessions.data.find((session) => session.payment_status === 'paid');
    return paid ? (paid.amount_total ?? invoice.paymentLinkAmountPence ?? 0) : null;
  }
  if (invoice.paymentProvider === 'REVOLUT') {
    const order = await revolut<{ state: string; amount: number }>(await paymentKey('REVOLUT'), 'GET', `/api/orders/${encodeURIComponent(invoice.paymentReference)}`);
    return order.state === 'completed' ? order.amount : null;
  }
  return null;
};

// Polling instead of webhooks: nothing to configure in the client's Stripe or Revolut dashboard, and a missed
// event can never leave an invoice unpaid in the CRM.
export const reconcilePayments = async () => {
  const open = nodes(
    (
      await gql<{ invoices: { edges: { node: InvoiceForPayment }[] } }>(
        `{ invoices(filter: { paymentLinkStatus: { eq: OPEN } }, first: 200) { edges { node { ${INVOICE_FIELDS} } } } }`,
      )
    ).invoices,
  );
  const result = { checked: 0, paid: 0, closed: 0, errors: 0 };
  for (const invoice of open) {
    result.checked += 1;
    if (!PAYABLE_STATUSES.includes(invoice.status)) {
      await closeLink(invoice);
      await updateInvoice(invoice.id, { paymentLinkStatus: invoice.status === 'PAID' ? 'PAID' : 'CANCELLED' });
      result.closed += 1;
      continue;
    }
    try {
      const amount = await paidAmount(invoice);
      if (amount === null) continue;
      const paidSoFar = microsToPence(invoice.amountPaid?.amountMicros) + amount;
      const fullyPaid = paidSoFar >= microsToPence(invoice.total?.amountMicros);
      await updateInvoice(invoice.id, {
        amountPaid: gbp(paidSoFar),
        status: fullyPaid ? 'PAID' : 'PART_PAID',
        ...(fullyPaid ? { paidDate: todayInLondon() } : {}),
        paymentLinkStatus: 'PAID',
      });
      if (invoice.paymentProvider === 'STRIPE') await closeLink({ ...invoice, paymentLinkStatus: 'OPEN' });
      result.paid += 1;
    } catch {
      result.errors += 1;
    }
  }
  return result;
};
