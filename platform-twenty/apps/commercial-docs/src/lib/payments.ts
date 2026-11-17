import { createHash, randomUUID } from 'node:crypto';

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

type Money = { amountMicros: number | string | null } | null;

type CreditNoteForPayment = { kind: string | null; status: string | null; issuedAt: string | null; total: Money };

type InvoiceForPayment = {
  id: string;
  invoiceNumber: string;
  kind: string | null;
  status: string;
  total: Money;
  amountPaid: Money;
  paymentProvider: PaymentProvider | null;
  paymentLinkUrl: string;
  paymentReference: string;
  paymentLinkStatus: string | null;
  paymentLinkAmountPence: number | null;
  paymentLinkError: string | null;
  creditNotes: { edges: { node: CreditNoteForPayment }[] } | null;
};

type Provider = Exclude<PaymentProvider, 'NONE'>;

const INVOICE_FIELDS = `id invoiceNumber kind status total { amountMicros } amountPaid { amountMicros } paymentProvider paymentLinkUrl paymentReference
  paymentLinkStatus paymentLinkAmountPence paymentLinkError creditNotes(first: 100) { edges { node { kind status issuedAt total { amountMicros } } } }`;

const loadInvoice = async (id: string) =>
  nodes((await gql<{ invoices: { edges: { node: InvoiceForPayment }[] } }>(`query($id: UUID!) { invoices(filter: { id: { eq: $id } }) { edges { node { ${INVOICE_FIELDS} } } } }`, { id })).invoices)[0] ?? null;

const updateInvoice = (id: string, data: Record<string, unknown>) =>
  gql(`mutation($id: UUID!, $data: InvoiceUpdateInput!) { updateInvoice(id: $id, data: $data) { id } }`, { id, data });

const problem = (error: unknown) => (error as Error).message.slice(0, 300);

const creditedPence = (creditNotes: CreditNoteForPayment[]) =>
  creditNotes
    .filter((note) => note.kind === 'CREDIT_NOTE' && Boolean(note.issuedAt) && note.status !== 'VOID')
    .reduce((sum, note) => sum + microsToPence(note.total?.amountMicros), 0);

// Always what is still owed, never more: part payments and issued credit notes against the invoice are taken off.
export const outstandingPence = (invoice: Pick<InvoiceForPayment, 'total' | 'amountPaid'> & { creditNotes?: InvoiceForPayment['creditNotes'] }) =>
  Math.max(0, microsToPence(invoice.total?.amountMicros) - microsToPence(invoice.amountPaid?.amountMicros) - creditedPence(nodes(invoice.creditNotes)));

const PAYMENT_PAGE_HOSTS = ['buy.stripe.com', 'checkout.stripe.com', 'checkout.revolut.com', 'sandbox-checkout.revolut.com'];
// Pages of the payment test double (tests/commercial-docs/mock-payments.mjs); the .test domain never resolves publicly.
const TEST_DOUBLE_PAGE_HOSTS = ['buy.stripe.test', 'checkout.revolut.test'];

// The pay-now link is an editable field, so only the providers' own payment pages may reach a client's inbox.
export const isPaymentPageUrl = (url: string | null | undefined, allowTestDoubles = Boolean(process.env.STRIPE_API_URL || process.env.REVOLUT_API_URL)) => {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const hosts = allowTestDoubles ? [...PAYMENT_PAGE_HOSTS, ...TEST_DOUBLE_PAGE_HOSTS] : PAYMENT_PAGE_HOSTS;
  return parsed.protocol === 'https:' && !parsed.username && !parsed.password && parsed.port === '' && hosts.includes(parsed.hostname);
};

const PAYABLE_STATUSES = ['ISSUED', 'PART_PAID', 'OVERDUE'];

type KeyLookup = (provider: Provider) => Promise<string>;

const cachedKeys = (): KeyLookup => {
  const keys = new Map<Provider, Promise<string>>();
  return (provider) => {
    const known = keys.get(provider);
    if (known) return known;
    const key = paymentKey(provider);
    keys.set(provider, key);
    return key;
  };
};

const closeLink = async (invoice: InvoiceForPayment, keyFor: KeyLookup = paymentKey) => {
  if (!invoice.paymentReference || invoice.paymentLinkStatus !== 'OPEN') return;
  try {
    if (invoice.paymentProvider === 'STRIPE') await stripe(await keyFor('STRIPE'), 'POST', `/v1/payment_links/${encodeURIComponent(invoice.paymentReference)}`, { active: false });
    if (invoice.paymentProvider === 'REVOLUT') await revolut(await keyFor('REVOLUT'), 'POST', `/api/orders/${encodeURIComponent(invoice.paymentReference)}/cancel`);
  } catch {
    // A link that cannot be closed (already paid, already cancelled) is still marked closed here.
  }
};

const paidAmount = async (invoice: InvoiceForPayment, keyFor: KeyLookup = paymentKey): Promise<number | null> => {
  if (invoice.paymentProvider === 'STRIPE') {
    const sessions = await stripe<{ data: { payment_status: string; amount_total: number | null }[] }>(
      await keyFor('STRIPE'),
      'GET',
      `/v1/checkout/sessions?payment_link=${encodeURIComponent(invoice.paymentReference)}&status=complete&limit=1`,
    );
    const paid = sessions.data.find((session) => session.payment_status === 'paid');
    return paid ? (paid.amount_total ?? invoice.paymentLinkAmountPence ?? 0) : null;
  }
  if (invoice.paymentProvider === 'REVOLUT') {
    const order = await revolut<{ state: string; amount: number }>(await keyFor('REVOLUT'), 'GET', `/api/orders/${encodeURIComponent(invoice.paymentReference)}`);
    return order.state === 'completed' ? order.amount : null;
  }
  return null;
};

// Only while the link is still open with this reference, so overlapping checks count one payment once.
const recordLinkPayment = async (invoice: InvoiceForPayment, amount: number) => {
  const paidSoFar = microsToPence(invoice.amountPaid?.amountMicros) + amount;
  const fullyPaid = outstandingPence({ ...invoice, amountPaid: gbp(paidSoFar) }) === 0;
  const { updateInvoices } = await gql<{ updateInvoices: { id: string }[] }>(
    `mutation($id: UUID!, $reference: String!, $data: InvoiceUpdateInput!) {
      updateInvoices(filter: { id: { eq: $id }, paymentLinkStatus: { eq: OPEN }, paymentReference: { eq: $reference } }, data: $data) { id }
    }`,
    {
      id: invoice.id,
      reference: invoice.paymentReference,
      data: {
        amountPaid: gbp(paidSoFar),
        status: fullyPaid ? 'PAID' : 'PART_PAID',
        ...(fullyPaid ? { paidDate: todayInLondon() } : {}),
        paymentLinkStatus: 'PAID',
        paymentLinkError: '',
        paymentCheckedAt: new Date().toISOString(),
      },
    },
  );
  return updateInvoices.length > 0;
};

// Writes only if no newer link request has started since, so a slow attempt cannot overwrite a newer link.
const updateIfLatestRequest = async (id: string, requestKey: string, data: Record<string, unknown>) => {
  const { updateInvoices } = await gql<{ updateInvoices: { id: string }[] }>(
    `mutation($id: UUID!, $requestKey: String!, $data: InvoiceUpdateInput!) { updateInvoices(filter: { id: { eq: $id }, paymentLinkRequestKey: { eq: $requestKey } }, data: $data) { id } }`,
    { id, requestKey, data },
  );
  return updateInvoices.length > 0;
};

const createLink = async (invoice: InvoiceForPayment, provider: Provider, amount: number, businessName: string, requestKey: string) => {
  const key = await paymentKey(provider);
  const description = `Invoice ${invoice.invoiceNumber}${businessName ? ` from ${businessName}` : ''}`;
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
      requestKey,
    );
    return { url: link.url, reference: link.id };
  }
  const order = await revolut<{ id: string; checkout_url: string }>(key, 'POST', '/api/orders', {
    amount,
    currency: 'GBP',
    description,
    merchant_order_data: { reference: invoice.invoiceNumber },
    metadata: { invoiceId: invoice.id },
  });
  return { url: order.checkout_url, reference: order.id };
};

// Creates a pay-now link for what is owed, or keeps the open one if the amount has not changed.
export const ensurePaymentLink = async (invoiceId: string, provider: Provider, businessName: string) => {
  let invoice = await loadInvoice(invoiceId);
  if (!invoice) throw new PaymentError('Invoice not found.');
  if (invoice.kind === 'CREDIT_NOTE') throw new PaymentError('Credit notes are not paid online.');
  if (!PAYABLE_STATUSES.includes(invoice.status)) throw new PaymentError('Only issued, part-paid or overdue invoices can be paid online.');
  let amount = outstandingPence(invoice);
  if (amount > 0 && invoice.paymentLinkStatus === 'OPEN' && invoice.paymentProvider === provider && invoice.paymentLinkAmountPence === amount && invoice.paymentLinkUrl)
    return invoice.paymentLinkUrl;

  // Closed before it is checked, so no new payment can start on it and one already made is recorded, not lost.
  if (invoice.paymentLinkStatus === 'OPEN' && invoice.paymentReference) {
    await closeLink(invoice);
    const paid = await paidAmount(invoice);
    if (paid !== null) {
      await recordLinkPayment(invoice, paid);
      invoice = await loadInvoice(invoiceId);
      if (!invoice || !PAYABLE_STATUSES.includes(invoice.status)) throw new PaymentError('This invoice has just been paid online.');
      amount = outstandingPence(invoice);
    }
  }
  if (amount <= 0) {
    if (invoice.paymentLinkStatus === 'OPEN') await updateInvoice(invoice.id, { paymentLinkStatus: 'CANCELLED' });
    throw new PaymentError('Nothing is owed on this invoice.');
  }

  // A fresh key per attempt: Stripe replays a reused key for 24 hours, which could hand back a link closed since.
  const requestKey = randomUUID();
  await updateInvoice(invoice.id, { paymentLinkRequestKey: requestKey });
  let link: { url: string; reference: string };
  try {
    link = await createLink(invoice, provider, amount, businessName, requestKey);
    if (!/^https:\/\//.test(link.url)) throw new PaymentError('The payment provider did not return a secure link.');
  } catch (error) {
    await updateIfLatestRequest(invoice.id, requestKey, { paymentLinkStatus: 'FAILED', paymentLinkUrl: '', paymentReference: '', paymentLinkError: `Could not create the link: ${problem(error)}` });
    throw error;
  }
  const stored = await updateIfLatestRequest(invoice.id, requestKey, {
    paymentProvider: provider,
    paymentLinkUrl: link.url,
    paymentReference: link.reference,
    paymentLinkStatus: 'OPEN',
    paymentLinkAmountPence: amount,
    paymentLinkCreatedAt: new Date().toISOString(),
    paymentLinkError: '',
  });
  if (!stored) {
    await closeLink({ ...invoice, paymentProvider: provider, paymentReference: link.reference, paymentLinkStatus: 'OPEN' });
    throw new PaymentError('Another pay-now link was created for this invoice at the same moment; that one is kept.');
  }
  return link.url;
};

const RECONCILE_PAGE_SIZE = 50;
// Stops in time to return a summary before the function's time limit; the rest waits for the next run.
const RECONCILE_BUDGET_MS = 240_000;

// Polling instead of webhooks: nothing to configure in the client's Stripe or Revolut dashboard, and a missed
// event can never leave an invoice unpaid in the CRM.
export const reconcilePayments = async () => {
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + RECONCILE_BUDGET_MS;
  const keyFor = cachedKeys();
  const seen = new Set<string>();
  const result = { checked: 0, paid: 0, closed: 0, errors: 0 };
  // Each check stamps paymentCheckedAt, so a checked link leaves this filter and the next page starts after it.
  const filter = { paymentLinkStatus: { eq: 'OPEN' }, or: [{ paymentCheckedAt: { is: 'NULL' } }, { paymentCheckedAt: { lt: startedAt } }] };
  while (Date.now() < deadline) {
    const page = nodes(
      (
        await gql<{ invoices: { edges: { node: InvoiceForPayment }[] } }>(
          `query($filter: InvoiceFilterInput!) { invoices(filter: $filter, orderBy: [{ paymentCheckedAt: AscNullsFirst }], first: ${RECONCILE_PAGE_SIZE}) { edges { node { ${INVOICE_FIELDS} } } } }`,
          { filter },
        )
      ).invoices,
    ).filter((invoice) => !seen.has(invoice.id));
    if (page.length === 0) break;
    for (const invoice of page) {
      seen.add(invoice.id);
      result.checked += 1;
      const paymentCheckedAt = new Date().toISOString();
      try {
        if (!PAYABLE_STATUSES.includes(invoice.status)) {
          await closeLink(invoice, keyFor);
          await updateInvoice(invoice.id, { paymentLinkStatus: invoice.status === 'PAID' ? 'PAID' : 'CANCELLED', paymentCheckedAt });
          result.closed += 1;
          continue;
        }
        const amount = await paidAmount(invoice, keyFor);
        if (amount === null) {
          await updateInvoice(invoice.id, { paymentCheckedAt, ...(invoice.paymentLinkError ? { paymentLinkError: '' } : {}) });
          continue;
        }
        if (!(await recordLinkPayment(invoice, amount))) continue;
        if (invoice.paymentProvider === 'STRIPE') await closeLink(invoice, keyFor);
        result.paid += 1;
      } catch (error) {
        result.errors += 1;
        await updateInvoice(invoice.id, { paymentCheckedAt, paymentLinkError: `Could not check the payment: ${problem(error)}` }).catch(() => undefined);
      }
    }
  }
  return result;
};
