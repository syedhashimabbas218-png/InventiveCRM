import { createHmac, timingSafeEqual } from 'node:crypto';

import nodemailer from 'nodemailer';

import { DELIVERY_CHANNELS, type DeliveryChannel, type DeliveryStatus } from 'src/constants/enums';
import { downloadFile, gql, metadata, nodes } from 'src/lib/api';
import { type BusinessProfile } from 'src/lib/compliance';
import { formatUkDate, todayInLondon } from 'src/lib/dates';
import { formatGbp, microsToPence } from 'src/lib/money';
import { ensurePaymentLink, isPaymentPageUrl, outstandingPence } from 'src/lib/payments';

type DocumentKind = 'invoice' | 'quote';

type Recipient = {
  id: string;
  name: { firstName: string | null; lastName: string | null } | null;
  emails: { primaryEmail: string | null } | null;
  phones: { primaryPhoneNumber: string | null; primaryPhoneCallingCode: string | null } | null;
  preferredChannel: 'EMAIL' | 'WHATSAPP' | 'EMAIL_AND_WHATSAPP' | null;
  whatsappOptIn: boolean | null;
};

export type SendableDocument = {
  kind: DocumentKind;
  id: string;
  type: 'INVOICE' | 'CREDIT_NOTE' | 'QUOTE';
  number: string;
  status: string | null;
  totalPence: number;
  // What is still owed on an invoice after payments and credit notes; the total for other documents.
  amountDuePence: number;
  issueDate: string | null;
  dueDate: string | null;
  validUntil: string | null;
  pdf: PdfFile | null;
  recipient: Recipient | null;
  paymentUrl: string | null;
};

type PdfFile = { fileId: string; label: string; url: string };

type DocumentNode = {
  status: string | null;
  total: { amountMicros: number | string | null } | null;
  issueDate: string | null;
  pdf: PdfFile[] | null;
  person: Recipient | null;
};

type InvoiceNode = DocumentNode & {
  invoiceNumber: string;
  kind: string | null;
  dueDate: string | null;
  amountPaid: { amountMicros: number | string | null } | null;
  creditNotes: { edges: { node: { kind: string | null; status: string | null; issuedAt: string | null; total: { amountMicros: number | string | null } | null } }[] } | null;
  paymentLinkUrl: string | null;
  paymentLinkStatus: string | null;
  paymentLinkAmountPence: number | null;
};
type QuoteNode = DocumentNode & { quoteNumber: string; validUntil: string | null };

const RECIPIENT = `person { id name { firstName lastName } emails { primaryEmail } phones { primaryPhoneNumber primaryPhoneCallingCode } preferredChannel whatsappOptIn }`;

type LoadedDocument = SendableDocument & { hasStaleLink: boolean };

const INVOICE_DOCUMENT_FIELDS = `id invoiceNumber kind status total { amountMicros } amountPaid { amountMicros } issueDate dueDate
  creditNotes(first: 100) { edges { node { kind status issuedAt total { amountMicros } } } }
  paymentLinkUrl paymentLinkStatus paymentLinkAmountPence pdf { fileId label url } ${RECIPIENT}`;

const loadDocument = async (kind: DocumentKind, id: string): Promise<LoadedDocument | null> => {
  if (kind === 'invoice') {
    const data = await gql<{ invoices: { edges: { node: InvoiceNode }[] } }>(
      `query($id: UUID!) { invoices(filter: { id: { eq: $id } }) { edges { node { ${INVOICE_DOCUMENT_FIELDS} } } } }`,
      { id },
    );
    const invoice = nodes(data.invoices)[0];
    if (!invoice) return null;
    const type = invoice.kind === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : 'INVOICE';
    const totalPence = microsToPence(invoice.total?.amountMicros);
    const amountDuePence = type === 'INVOICE' ? outstandingPence(invoice) : totalPence;
    const openLink = type === 'INVOICE' && invoice.paymentLinkStatus === 'OPEN';
    const linkMatchesAmount = invoice.paymentLinkAmountPence === amountDuePence;
    return {
      kind,
      id,
      type,
      number: invoice.invoiceNumber,
      status: invoice.status,
      totalPence,
      amountDuePence,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      validUntil: null,
      pdf: invoice.pdf?.[0] ?? null,
      recipient: invoice.person,
      paymentUrl: openLink && linkMatchesAmount && isPaymentPageUrl(invoice.paymentLinkUrl) ? invoice.paymentLinkUrl : null,
      hasStaleLink: openLink && !linkMatchesAmount && amountDuePence > 0,
    };
  }
  const data = await gql<{ quotes: { edges: { node: QuoteNode }[] } }>(
    `query($id: UUID!) { quotes(filter: { id: { eq: $id } }) { edges { node { id quoteNumber status total { amountMicros } issueDate validUntil pdf { fileId label url } ${RECIPIENT} } } } }`,
    { id },
  );
  const quote = nodes(data.quotes)[0];
  if (!quote) return null;
  const totalPence = microsToPence(quote.total?.amountMicros);
  return {
    kind,
    id,
    type: 'QUOTE',
    number: quote.quoteNumber,
    status: quote.status,
    totalPence,
    amountDuePence: totalPence,
    issueDate: quote.issueDate,
    dueDate: null,
    validUntil: quote.validUntil,
    pdf: quote.pdf?.[0] ?? null,
    recipient: quote.person,
    paymentUrl: null,
    hasStaleLink: false,
  };
};

const DOCUMENT_LABEL = { INVOICE: 'Invoice', CREDIT_NOTE: 'Credit note', QUOTE: 'Quote' } as const;

const businessName = (profile: BusinessProfile) => profile.tradingName || profile.legalName || 'Your supplier';

const firstName = (recipient: Recipient | null) => recipient?.name?.firstName || 'there';

// UK numbers are stored as calling code + national number; WhatsApp needs E.164 without the leading 0.
export const toE164 = (phones: Recipient['phones']): string | null => {
  const number = (phones?.primaryPhoneNumber ?? '').replace(/[^\d+]/g, '');
  if (!number) return null;
  if (number.startsWith('+')) return number;
  const callingCode = (phones?.primaryPhoneCallingCode || '+44').replace(/[^\d+]/g, '');
  return `${callingCode.startsWith('+') ? callingCode : `+${callingCode}`}${number.replace(/^0+/, '')}`;
};

export const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const buildEmail = (document: SendableDocument, profile: BusinessProfile, { reminder, paymentLink = false }: { reminder: boolean; paymentLink?: boolean }) => {
  const label = DOCUMENT_LABEL[document.type];
  const amount = formatGbp(document.totalPence);
  const amountDue = formatGbp(document.amountDuePence);
  const partOf = document.amountDuePence < document.totalPence ? `${amountDue} of ` : '';
  const subject = paymentLink
    ? `Pay invoice ${document.number} from ${businessName(profile)} online`
    : reminder
      ? `Reminder: invoice ${document.number} from ${businessName(profile)} is overdue`
      : `${label} ${document.number} from ${businessName(profile)}`;
  const lines = [
    `Hello ${firstName(document.recipient)},`,
    '',
    reminder
      ? `Our records show that ${partOf}invoice ${document.number} for ${amount}, due on ${formatUkDate(document.dueDate)}, has not been paid yet. If you have already paid, thank you, and please ignore this reminder.`
      : document.type === 'QUOTE'
        ? `Please find attached quote ${document.number} for ${amount}${document.validUntil ? `, valid until ${formatUkDate(document.validUntil)}` : ''}. Reply to this email to accept it or ask any questions.`
        : document.type === 'CREDIT_NOTE'
          ? `Please find attached credit note ${document.number} for ${amount}.`
          : `Please find attached invoice ${document.number} for ${amount}${document.dueDate ? `, due on ${formatUkDate(document.dueDate)}` : ''}.`,
    ...(paymentLink ? ['', `You can pay invoice ${document.number} (${amountDue}) securely online:`] : document.paymentUrl ? ['', 'Pay online:'] : []),
    ...(document.paymentUrl ? [document.paymentUrl] : []),
    ...(profile.emailMessage ? ['', profile.emailMessage] : []),
    '',
    'Kind regards,',
    businessName(profile),
  ];
  return {
    subject,
    text: lines.join('\n'),
    html: lines
      .map((line) =>
        line === document.paymentUrl && line
          ? `<p><a href="${escapeHtml(line)}" style="display:inline-block;padding:10px 18px;border-radius:4px;background:#3e63dd;color:#ffffff;text-decoration:none;font-weight:600">Pay ${escapeHtml(amountDue)} now</a></p>`
          : line
            ? `<p>${escapeHtml(line)}</p>`
            : '',
      )
      .join(''),
  };
};

const createDelivery = async (document: SendableDocument, data: Record<string, unknown>) => {
  const { createDocumentDelivery } = await gql<{ createDocumentDelivery: { id: string } }>(
    `mutation($data: DocumentDeliveryCreateInput!) { createDocumentDelivery(data: $data) { id } }`,
    { data: { ...data, [`${document.kind}Id`]: document.id } },
  );
  return createDocumentDelivery.id;
};

const STATUS_ORDER: DeliveryStatus[] = ['QUEUED', 'SENT', 'FAILED', 'DELIVERED', 'READ'];

const SENDABLE_STATUSES: Record<DocumentKind, string[]> = { invoice: ['ISSUED', 'PART_PAID', 'OVERDUE', 'PAID'], quote: ['SENT'] };
const MAX_SENDS_PER_DOCUMENT_PER_DAY = 5;
const MAX_SENDS_PER_WORKSPACE_PER_DAY = 300;

const DELIVERY_CHANNEL_VALUES = Object.keys(DELIVERY_CHANNELS) as DeliveryChannel[];

// undefined means the contact's preferred channels; null means the list holds something other than EMAIL or WHATSAPP.
// Each channel is used once, so repeating it in the list cannot multiply sends.
export const requestedChannels = (value: unknown): DeliveryChannel[] | undefined | null => {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) return undefined;
  if (!Array.isArray(value) || !value.every((channel) => DELIVERY_CHANNEL_VALUES.some((known) => known === channel))) return null;
  return DELIVERY_CHANNEL_VALUES.filter((channel) => value.includes(channel));
};

const deliveriesSince = async (since: string, document?: SendableDocument) => {
  const filter = { createdAt: { gte: since }, ...(document ? { [`${document.kind}Id`]: { eq: document.id } } : {}) };
  const data = await gql<{ documentDeliveries: { totalCount: number } }>(
    `query($filter: DocumentDeliveryFilterInput!) { documentDeliveries(filter: $filter) { totalCount } }`,
    { filter },
  );
  return data.documentDeliveries.totalCount;
};

// Limits stop a script or a stolen API key from spamming a client's customers or burning our sending reputation.
const assertWithinSendingLimits = async (document: SendableDocument, sends: number) => {
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const documentSends = await deliveriesSince(dayAgo, document);
  if (documentSends + sends > MAX_SENDS_PER_DOCUMENT_PER_DAY)
    throw new Error(`This document has been sent ${documentSends} times in the last 24 hours; the limit is ${MAX_SENDS_PER_DOCUMENT_PER_DAY}.`);
  if ((await deliveriesSince(dayAgo)) + sends > MAX_SENDS_PER_WORKSPACE_PER_DAY)
    throw new Error(`The daily sending limit of ${MAX_SENDS_PER_WORKSPACE_PER_DAY} documents for this workspace has been reached. Contact support to raise it.`);
};

// WhatsApp callbacks can arrive out of order or before the hand-off returns, so a status only moves forward.
export const updateDelivery = async (id: string, status: DeliveryStatus, extra: Record<string, unknown> = {}) => {
  const data = await gql<{ documentDeliveries: { edges: { node: { status: DeliveryStatus | null } }[] } }>(
    `query($id: UUID!) { documentDeliveries(filter: { id: { eq: $id } }) { edges { node { status } } } }`,
    { id },
  );
  const current = nodes(data.documentDeliveries)[0];
  if (!current) throw new Error(`Delivery ${id} not found`);
  const moveForward = STATUS_ORDER.indexOf(status) > STATUS_ORDER.indexOf(current.status ?? 'QUEUED');
  await gql(`mutation($id: UUID!, $data: DocumentDeliveryUpdateInput!) { updateDocumentDelivery(id: $id, data: $data) { id } }`, {
    id,
    data: { ...extra, ...(moveForward ? { status, statusUpdatedAt: new Date().toISOString() } : {}) },
  });
};

const sendFromOurServer = async (document: SendableDocument, profile: BusinessProfile, to: string, email: ReturnType<typeof buildEmail>) => {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURITY, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM_ADDRESS } = process.env;
  if (!SMTP_HOST || !SMTP_FROM_ADDRESS) throw new Error('The InventiveCRM mail server is not configured (SMTP_HOST and SMTP_FROM_ADDRESS).');
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: SMTP_SECURITY === 'TLS',
    requireTLS: SMTP_SECURITY === 'STARTTLS',
    ignoreTLS: SMTP_SECURITY === 'NONE',
    auth: SMTP_USERNAME ? { user: SMTP_USERNAME, pass: SMTP_PASSWORD } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  const info = await transport.sendMail({
    // Our domain signs this mail, so the sender always shows it comes through us, whatever name the client chose.
    from: { name: `${businessName(profile)} via InventiveCRM`, address: SMTP_FROM_ADDRESS },
    replyTo: profile.email || undefined,
    to,
    subject: email.subject,
    text: email.text,
    html: email.html,
    attachments: document.pdf ? [{ filename: document.pdf.label, content: Buffer.from(await downloadFile(document.pdf.url)), contentType: 'application/pdf' }] : [],
  });
  return { method: 'InventiveCRM mail server', providerMessageId: info.messageId };
};

const sendFromClientMailbox = async (document: SendableDocument, profile: BusinessProfile, to: string, email: ReturnType<typeof buildEmail>) => {
  const { myConnectedAccounts } = await metadata<{ myConnectedAccounts: { id: string; handle: string }[] }>(`{ myConnectedAccounts { id handle } }`);
  const wanted = (profile.clientMailbox ?? '').trim().toLowerCase();
  const account = myConnectedAccounts.find((candidate) => candidate.handle.toLowerCase() === wanted);
  if (!account)
    throw new Error(`Mailbox ${profile.clientMailbox || '(not set)'} is not connected or not shared with the workspace (Settings > Accounts).`);
  const { sendEmail } = await metadata<{ sendEmail: { success: boolean; error: string | null } }>(
    `mutation($input: SendEmailInput!) { sendEmail(input: $input) { success error } }`,
    {
      input: {
        connectedAccountId: account.id,
        to,
        subject: email.subject,
        body: email.html,
        files: document.pdf ? [{ id: document.pdf.fileId, name: document.pdf.label }] : [],
        ...(document.recipient ? { targetRecord: { objectNameSingular: 'person', recordId: document.recipient.id } } : {}),
      },
    },
  );
  if (!sendEmail.success) throw new Error(sendEmail.error || 'The mailbox refused the message.');
  return { method: `Mailbox ${account.handle}`, providerMessageId: null };
};

const NO_SIGNED_IN_USER = 'requires a token bound to a user workspace';

// Mailboxes only send for a signed-in user, so automatic sends (recurring invoices, reminders, API calls) use our server,
// still under the business's name and reply-to address.
const sendEmail = async (document: SendableDocument, profile: BusinessProfile, to: string, email: ReturnType<typeof buildEmail>) => {
  if (profile.emailSendingMethod !== 'CLIENT_MAILBOX') return sendFromOurServer(document, profile, to, email);
  try {
    return await sendFromClientMailbox(document, profile, to, email);
  } catch (error) {
    if (!(error as Error).message.includes(NO_SIGNED_IN_USER)) throw error;
    const sent = await sendFromOurServer(document, profile, to, email);
    return { ...sent, method: `${sent.method} (automatic send, no signed-in user for ${profile.clientMailbox})` };
  }
};

// Self-hosted servers without PUBLIC_DOMAIN_URL leave TWENTY_FUNCTIONS_URL empty and serve routes on <workspace URL>/s.
export const functionsBaseUrl = async () => {
  if (process.env.TWENTY_FUNCTIONS_URL) return process.env.TWENTY_FUNCTIONS_URL.replace(/\/$/, '');
  const { currentWorkspace } = await metadata<{ currentWorkspace: { workspaceUrls: { customUrl: string | null; subdomainUrl: string } } }>(
    `{ currentWorkspace { workspaceUrls { customUrl subdomainUrl } } }`,
  );
  return `${(currentWorkspace.workspaceUrls.customUrl || currentWorkspace.workspaceUrls.subdomainUrl).replace(/\/$/, '')}/s`;
};

// Hands the document to the WhatsApp (WABA) service, which owns templates, numbers and the Meta connection.
const handOffToWhatsApp = async (document: SendableDocument, profile: BusinessProfile, phone: string, deliveryId: string, reminder: boolean, paymentLink = false) => {
  const { WHATSAPP_GATEWAY_URL, WHATSAPP_GATEWAY_SECRET } = process.env;
  if (!WHATSAPP_GATEWAY_URL || !WHATSAPP_GATEWAY_SECRET) throw new Error('The WhatsApp service is not configured (WHATSAPP_GATEWAY_URL and WHATSAPP_GATEWAY_SECRET).');
  const body = JSON.stringify({
    event: paymentLink ? 'invoice.payment_link' : reminder ? 'invoice.overdue_reminder' : `${document.type.toLowerCase()}.send`,
    deliveryId,
    business: { name: businessName(profile), replyEmail: profile.email || null },
    recipient: { name: [document.recipient?.name?.firstName, document.recipient?.name?.lastName].filter(Boolean).join(' '), phone, whatsappOptIn: true },
    document: {
      type: document.type,
      number: document.number,
      total: { amountPence: document.totalPence, currency: 'GBP', formatted: formatGbp(document.totalPence) },
      amountDue: { amountPence: document.amountDuePence, currency: 'GBP', formatted: formatGbp(document.amountDuePence) },
      issueDate: document.issueDate,
      dueDate: document.dueDate,
      validUntil: document.validUntil,
      pdf: document.pdf ? { url: document.pdf.url, filename: document.pdf.label } : null,
      paymentUrl: document.paymentUrl,
    },
    statusCallbackUrl: `${await functionsBaseUrl()}/whatsapp/status`,
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', WHATSAPP_GATEWAY_SECRET).update(`${timestamp}.${body}`).digest('hex');
  const response = await fetch(WHATSAPP_GATEWAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-InventiveCRM-Timestamp': timestamp, 'X-InventiveCRM-Signature': `sha256=${signature}` },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const reply = (await response.json().catch(() => ({}))) as { messageId?: string; error?: string };
  if (!response.ok) throw new Error(`WhatsApp service answered ${response.status}${reply.error ? `: ${reply.error}` : ''}`);
  return { method: 'WhatsApp service', providerMessageId: reply.messageId ?? null };
};

export const verifyWhatsAppSignature = (rawBody: string, timestamp: string | undefined, signature: string | undefined) => {
  const secret = process.env.WHATSAPP_GATEWAY_SECRET;
  if (!secret || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
};

export const channelsFor = (recipient: Recipient | null): DeliveryChannel[] => {
  switch (recipient?.preferredChannel) {
    case 'WHATSAPP':
      return ['WHATSAPP'];
    case 'EMAIL_AND_WHATSAPP':
      return ['EMAIL', 'WHATSAPP'];
    default:
      return ['EMAIL'];
  }
};

export type DeliveryResult = { channel: DeliveryChannel; status: DeliveryStatus; recipient: string | null; error?: string };

// Sends one issued document to the client on each channel and logs every attempt as a Delivery.
// A failed channel is recorded, never thrown, so issuing an invoice is not undone by a mail outage.
export const deliverDocument = async ({
  kind,
  id,
  profile,
  channels,
  reminder = false,
  paymentLink = false,
}: {
  kind: DocumentKind;
  id: string;
  profile: BusinessProfile;
  channels?: DeliveryChannel[];
  reminder?: boolean;
  paymentLink?: boolean;
}): Promise<DeliveryResult[]> => {
  let document = await loadDocument(kind, id);
  if (!document || !document.number || !SENDABLE_STATUSES[kind].includes(document.status ?? '')) return [];
  // A payment reminder only goes out for an invoice that is actually unpaid and past its due date.
  if (reminder && !(kind === 'invoice' && ['OVERDUE', 'PART_PAID'].includes(document.status ?? '') && document.dueDate && document.dueDate < todayInLondon() && document.amountDuePence > 0))
    return [];
  // A part payment or credit note since the link was made: the client is never asked for the old amount.
  const provider = profile.onlinePayments;
  if (document.hasStaleLink && (provider === 'STRIPE' || provider === 'REVOLUT')) {
    await ensurePaymentLink(id, provider, profile.tradingName || profile.legalName || '').catch((error: Error) =>
      console.error(`Could not replace the pay-now link of invoice ${id}: ${error.message}`),
    );
    document = (await loadDocument(kind, id)) ?? document;
  }
  if (paymentLink && !document.paymentUrl) return [];
  const sendChannels = [...new Set(channels ?? channelsFor(document.recipient))];
  await assertWithinSendingLimits(document, sendChannels.length);
  const results: DeliveryResult[] = [];
  const label = `${paymentLink ? 'Payment link for ' : reminder ? 'Reminder for ' : ''}${DOCUMENT_LABEL[document.type]} ${document.number}`;

  for (const channel of sendChannels) {
    const recipient =
      channel === 'EMAIL'
        ? document.recipient?.emails?.primaryEmail || null
        : document.recipient?.whatsappOptIn
          ? toE164(document.recipient.phones)
          : null;
    const deliveryId = await createDelivery(document, {
      name: `${label} by ${channel === 'EMAIL' ? 'email' : 'WhatsApp'}`,
      channel,
      recipient: recipient ?? '',
      status: 'QUEUED',
    });
    try {
      if (!recipient)
        throw new Error(
          channel === 'EMAIL'
            ? 'The contact has no email address.'
            : "The contact has no mobile number or has not agreed to WhatsApp messages (tick 'Agreed to WhatsApp messages').",
        );
      const sent =
        channel === 'WHATSAPP'
          ? await handOffToWhatsApp(document, profile, recipient, deliveryId, reminder, paymentLink)
          : await sendEmail(document, profile, recipient, buildEmail(document, profile, { reminder, paymentLink }));
      await updateDelivery(deliveryId, 'SENT', { method: sent.method, providerMessageId: sent.providerMessageId ?? '', sentAt: new Date().toISOString() });
      results.push({ channel, status: 'SENT', recipient });
    } catch (error) {
      await updateDelivery(deliveryId, 'FAILED', { errorMessage: (error as Error).message });
      results.push({ channel, status: 'FAILED', recipient, error: (error as Error).message });
    }
  }

  if (results.some((result) => result.status === 'SENT'))
    await gql(`mutation($id: UUID!, $data: ${kind === 'invoice' ? 'Invoice' : 'Quote'}UpdateInput!) { update${kind === 'invoice' ? 'Invoice' : 'Quote'}(id: $id, data: $data) { id } }`, {
      id,
      data: { lastSentAt: new Date().toISOString() },
    });
  return results;
};
