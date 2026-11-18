import { randomUUID } from 'node:crypto';

import { type ConversationHandling, type MessageDirection, type MessageStatus, type MessageType } from 'src/constants/enums';
import { verifyBodySignature } from 'src/lib/crypto';
import { normalisePhone } from 'src/lib/phones';
import { isUuid } from 'src/lib/rules';

// Everything this app knows about InventiveChat's API lives in this file, so a change on their side is one edit here.
// Contract: InventiveChat's CRM integration as confirmed by them (account, subscriptions, templates, sends, claims,
// consent, webhooks and flat error bodies). Fields marked ASSUMED are still unconfirmed.

export const INVENTIVECHAT_EVENT_TYPES = [
  'message.received',
  'message.sent',
  'message.status_updated',
  'message.send_outcome_unknown',
  'conversation.ready_for_reply',
  'conversation.human_takeover',
  'conversation.handoff_requested',
  'conversation.ai_resumed',
  'conversation.ai_approved',
  'conversation.updated',
  'customer.opted_out',
  'consent.updated',
  'template.status_updated',
] as const;

const REQUEST_TIMEOUT_MS = 15_000;
// InventiveChat allows 20 requests a second per key; one run stays under that on its own.
const MIN_GAP_MS = 60;
// Our key is a system key; InventiveChat replaces the actor id with the key's own.
const ACTOR = { type: 'system', id: 'inventivecrm' };
const CLAIM_TTL_SECONDS = 60;

export type WhatsAppNumber = { id: string; phone: string; verifiedName: string; active: boolean };
export type InventiveChatAccount = { tenantId: string; name: string; numbers: WhatsAppNumber[] };
export type InventiveChatTemplate = { name: string; language: string; category: string; body: string; parameters: string[]; quickReplies: string[]; status: string };
export type TemplateMessage = { name: string; languageCode: string; parameters: Record<string, string> };
export type SendResult = { messageId: string; conversationId: string | null; replayed: boolean };
export type InventiveChatContext = { key: string; tenantId: string };
export type StaffMember = { id: string; name: string };
export type Subscription = { id: string; url: string; status: string };
type MetaError = { code: string; title: string };
type ErrorDetails = { retryAfterSeconds?: number | null; metaError?: MetaError | null; pausedUntil?: string | null; allowedTopics?: string[]; details?: string[] };

export const inventiveChatBaseUrl = () => {
  const base = process.env.INVENTIVECHAT_API_URL?.trim().replace(/\/$/, '');
  if (!base) throw new InventiveChatError('WhatsApp is not set up on this server yet (INVENTIVECHAT_API_URL).', 0, 'not_configured');
  return base.endsWith('/v1') ? base : `${base}/v1`;
};

// Other 429s (rate_limited, too_many_concurrent_sends) pass in seconds; these can last minutes or hours.
const LATER_CODES = ['human_active', 'meta_rate_limited'];

export class InventiveChatError extends Error {
  readonly retryAfterSeconds: number | null;
  readonly metaError: MetaError | null;
  readonly pausedUntil: string | null;
  readonly allowedTopics: string[];
  readonly details: string[];

  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    extra: ErrorDetails = {},
  ) {
    super(message);
    this.retryAfterSeconds = extra.retryAfterSeconds ?? null;
    this.metaError = extra.metaError ?? null;
    this.pausedUntil = extra.pausedUntil ?? null;
    this.allowedTopics = extra.allowedTopics ?? [];
    this.details = extra.details ?? [];
  }

  // Worth trying again within seconds, with backoff and the same idempotency key.
  get retryable() {
    if (this.status === 0) return this.code === 'unreachable';
    if (this.status === 429) return !LATER_CODES.includes(this.code);
    return this.status >= 500 && this.code !== 'provider_rejected';
  }

  // Worth sending again later (minutes to hours), with the same idempotency key.
  get later() {
    return LATER_CODES.includes(this.code);
  }

  // A person took over with no time limit: wait for conversation.updated to show they handed it back.
  get waitsForHandBack() {
    return this.code === 'human_active' && this.pausedUntil === null && this.retryAfterSeconds === null;
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  meta_rate_limited: "Meta's sending limit for this WhatsApp number has been reached. The message will be sent when Meta allows it.",
  outside_window: 'The customer has not written in the last 24 hours, so only an approved template can be sent.',
  opted_out: 'This customer opted out of WhatsApp messages.',
  whatsapp_account_id_required: 'This InventiveChat account has several WhatsApp numbers. An admin can choose one in WhatsApp settings ("WhatsApp number id").',
  awaiting_approval: "Automated replies to this conversation need a person's approval in InventiveChat first.",
  paused: 'Automated replies to this conversation are paused in InventiveChat.',
  newer_message: 'The customer wrote again in the meantime, so the automated reply was not sent.',
  already_claimed: 'Another automation is already answering this conversation.',
  unauthenticated: 'InventiveChat refused the API key. An admin can reconnect WhatsApp under Settings, Accounts.',
  tenant_mismatch: 'The InventiveChat key belongs to another account. An admin can reconnect WhatsApp under Settings, Accounts.',
  rate_limited: 'WhatsApp is busy right now. Please try again in a moment.',
  too_many_concurrent_sends: 'WhatsApp is busy right now. Please try again in a moment.',
};

const at = (iso: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }).format(Date.parse(iso));

// What the person in the CRM (or the app that called the gateway) is told.
export const describeError = (error: unknown) => {
  if (!(error instanceof InventiveChatError)) return 'WhatsApp could not send this message. Please try again.';
  if (error.code === 'provider_rejected') return `WhatsApp refused the message: ${error.metaError?.title || error.message}${error.metaError?.code ? ` (Meta error ${error.metaError.code})` : ''}.`;
  if (error.code === 'human_active')
    return error.pausedUntil ? `A teammate is handling this customer in InventiveChat, so notifications wait until ${at(error.pausedUntil)}.` : 'A teammate took over this customer in InventiveChat, so notifications wait until they hand the conversation back.';
  if (error.code === 'out_of_scope') return `InventiveChat does not allow automated replies on this topic. Allowed topics: ${error.allowedTopics.length ? error.allowedTopics.join(', ') : 'none yet'}.`;
  if (error.code === 'invalid_payload' || error.code === 'invalid_envelope') return `InventiveChat refused the request: ${error.details.join('; ') || error.message}`;
  if (ERROR_MESSAGES[error.code]) return ERROR_MESSAGES[error.code] as string;
  if (error.status === 401) return ERROR_MESSAGES.unauthenticated as string;
  if (error.status === 403) return `The InventiveChat key is not allowed to do this (${error.code}). An admin can connect a system key.`;
  if (error.retryable) return 'WhatsApp is busy right now. Please try again in a moment.';
  return error.message;
};

let nextSlotAt = 0;

const pace = async () => {
  const now = Date.now();
  const startAt = Math.max(now, nextSlotAt);
  nextSlotAt = startAt + MIN_GAP_MS;
  if (startAt > now) await new Promise((resolve) => setTimeout(resolve, startAt - now));
};

const asString = (value: unknown) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');
const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);

// Refusals are flat: { reason, ... } for an operation, { error, details } for the envelope or the key.
export const readError = (status: number, body: unknown, retryAfterHeader: string | null) => {
  const flat = asRecord(body);
  const code = asString(flat.reason) || asString(flat.error) || `http_${status}`;
  const details = [...strings(flat.errors), ...strings(flat.details)];
  const seconds = Number(flat.retry_after_seconds ?? retryAfterHeader);
  const meta = asRecord(flat.meta_error);
  return new InventiveChatError(asString(flat.message) || details.join('; ') || `InventiveChat answered ${status} (${code})`, status, code, {
    retryAfterSeconds: flat.retry_after_seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    metaError: Object.keys(meta).length ? { code: asString(meta.code), title: asString(meta.title) } : null,
    pausedUntil: typeof flat.paused_until === 'string' && !Number.isNaN(Date.parse(flat.paused_until)) ? new Date(flat.paused_until).toISOString() : null,
    allowedTopics: strings(flat.allowed_topics),
    details,
  });
};

const call = async <TResult>(key: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<TResult> => {
  await pace();
  let response: Response;
  try {
    response = await fetch(`${inventiveChatBaseUrl()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'InventiveCRM-WhatsApp/0.1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new InventiveChatError(`InventiveChat did not answer: ${(error as Error).message}`, 0, 'unreachable');
  }
  const data = (await response.json().catch(() => null)) as TResult | null;
  if (!response.ok) throw readError(response.status, data, response.headers.get('retry-after'));
  return (data ?? {}) as TResult;
};

// Waits out a busy InventiveChat with backoff while the caller still has time, then gives up.
export const withRetry = async <TResult>(work: () => Promise<TResult>, deadline: number): Promise<TResult> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof InventiveChatError) || !error.retryable) throw error;
      const wait = error.retryAfterSeconds !== null ? error.retryAfterSeconds * 1000 : Math.min(4000, 400 * 2 ** attempt) + Math.floor(Math.random() * 200);
      if (Date.now() + wait > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
};

// "cor_" plus 8 to 64 letters or digits.
export const correlationId = (seed: string = randomUUID()) => `cor_${seed.replace(/[^A-Za-z0-9]/g, '').slice(0, 64).padEnd(8, '0')}`;

export const envelope = (context: InventiveChatContext, payload: Record<string, unknown>, idempotencyKey: string, correlation?: string) => ({
  tenant_id: context.tenantId,
  actor: ACTOR,
  correlation_id: correlationId(correlation),
  idempotency_key: idempotencyKey.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200),
  occurred_at: new Date().toISOString(),
  payload,
});

export const getAccount = async (key: string): Promise<InventiveChatAccount> => {
  const body = await call<Record<string, unknown>>(key, 'GET', '/account');
  const tenant = asRecord(body.tenant);
  const tenantId = asString(tenant.id);
  if (!tenantId) throw new InventiveChatError('InventiveChat did not say which account this key belongs to.', 502, 'bad_account');
  const numbers = Array.isArray(body.numbers) ? body.numbers : [];
  return {
    tenantId,
    name: asString(tenant.name),
    numbers: numbers.map((entry) => {
      const number = asRecord(entry);
      return { id: asString(number.id), phone: asString(number.display_phone_number), verifiedName: asString(number.verified_name), active: number.status === 'active' };
    }),
  };
};

export const chooseNumber = (numbers: WhatsAppNumber[], current: string | null) => {
  const active = numbers.filter((number) => number.active && number.id);
  return active.find((number) => number.id === current) ?? (active.length === 1 ? active[0] : null) ?? null;
};

export const listSubscriptions = async (context: InventiveChatContext): Promise<Subscription[]> => {
  const body = await call<Record<string, unknown>>(context.key, 'GET', '/subscriptions');
  return (Array.isArray(body.subscriptions) ? body.subscriptions : []).map((entry) => {
    const subscription = asRecord(entry);
    return { id: asString(subscription.id), url: asString(subscription.url), status: asString(subscription.status) };
  });
};

// There is no delete; a disabled subscription stops counting towards InventiveChat's ten active ones.
export const disableOurSubscriptions = async (context: InventiveChatContext, url: string) => {
  const ours = (await listSubscriptions(context)).filter((subscription) => subscription.url === url && subscription.status !== 'disabled' && subscription.id);
  for (const subscription of ours) await call(context.key, 'POST', `/subscriptions/${encodeURIComponent(subscription.id)}/disable`, envelope(context, {}, `crm_disable_${subscription.id}`));
  return ours.length;
};

// The signing secret is only returned here, once.
export const createSubscription = async (context: InventiveChatContext, url: string) => {
  const body = await call<Record<string, unknown>>(context.key, 'POST', '/subscriptions', envelope(context, { url, event_types: [...INVENTIVECHAT_EVENT_TYPES] }, `crm_subscription_${randomUUID()}`));
  const id = asString(body.id);
  const secret = asString(body.secret);
  if (!id || !secret) throw new InventiveChatError('InventiveChat did not return the webhook secret.', 502, 'bad_subscription');
  return { id, secret };
};

export const listTemplates = async (context: InventiveChatContext): Promise<InventiveChatTemplate[]> => {
  const body = await call<Record<string, unknown>>(context.key, 'GET', '/templates');
  return (Array.isArray(body.templates) ? body.templates : []).map((row) => {
    const template = asRecord(row);
    return {
      name: asString(template.name),
      language: asString(template.language),
      category: asString(template.category),
      body: asString(template.body),
      parameters: strings(template.parameters),
      quickReplies: strings(template.quick_replies),
      status: asString(template.status),
    };
  });
};

// Only approved templates can be sent; the requested language wins, then the workspace default, then any.
export const findTemplate = (templates: InventiveChatTemplate[], name: string, languages: (string | null | undefined)[]) => {
  const approved = templates.filter((template) => template.name === name && template.status === 'approved');
  for (const language of languages) {
    const match = language ? approved.find((template) => template.language === language) : undefined;
    if (match) return match;
  }
  return approved[0] ?? null;
};

// Values keyed by the template's parameter names; a list fills them in the template's order.
export const namedParameters = (template: Pick<InventiveChatTemplate, 'parameters'>, values: unknown) => {
  const given = Array.isArray(values) ? Object.fromEntries(template.parameters.map((name, index) => [name, values[index]])) : asRecord(values);
  const parameters: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of template.parameters) {
    const value = given[name];
    if (typeof value === 'string' || typeof value === 'number') parameters[name] = String(value).slice(0, 1024);
    else missing.push(name);
  }
  return { parameters, missing };
};

const readSend = (body: Record<string, unknown>): SendResult => {
  const messageId = asString(body.message_id);
  if (!messageId) throw new InventiveChatError('InventiveChat accepted the message but returned no id.', 502, 'bad_send');
  return { messageId, conversationId: asString(body.conversation_id) || null, replayed: body.replayed === true };
};

const templatePayload = (template: TemplateMessage) => ({ type: 'template', template: { name: template.name, language_code: template.languageCode, parameters: template.parameters } });

// A CRM user's message: InventiveChat records it as a human, takes the conversation over and pauses its AI.
const onBehalfOf = (member: StaffMember | undefined) => (member ? { on_behalf_of: { crm_member_id: member.id, name: member.name } } : {});

type Send = { idempotencyKey: string; correlation?: string };

const send = async (context: InventiveChatContext, payload: Record<string, unknown>, { idempotencyKey, correlation }: Send) =>
  readSend(await call<Record<string, unknown>>(context.key, 'POST', '/messages/send', envelope(context, payload, idempotencyKey, correlation)));

// Free text only goes out inside the 24-hour window; InventiveChat answers 422 outside_window otherwise.
export const sendStaffText = (context: InventiveChatContext, input: Send & { conversationId: string; text: string; member: StaffMember }) =>
  send(context, { conversation_id: input.conversationId, type: 'text', body: input.text, ...onBehalfOf(input.member) }, input);

// ASSUMED: GET /v1/conversations/:id names the latest inbound message as latest_inbound_message_id.
export const latestInboundMessageId = async (context: InventiveChatContext, conversationId: string) => {
  const body = await call<Record<string, unknown>>(context.key, 'GET', `/conversations/${encodeURIComponent(conversationId)}`);
  const conversation = Object.keys(asRecord(body.conversation)).length ? asRecord(body.conversation) : body;
  return asString(conversation.latest_inbound_message_id) || asString(asRecord(conversation.latest_inbound_message).id) || null;
};

// Automation answers only after claiming the conversation for the customer's latest message, on an allowed topic.
export const sendAutomationText = async (context: InventiveChatContext, input: Send & { conversationId: string; text: string; topic: string }) => {
  const latest = await latestInboundMessageId(context, input.conversationId);
  if (!latest) throw new InventiveChatError('The customer has not written in this conversation yet.', 409, 'outside_window');
  const claim = await call<Record<string, unknown>>(context.key, 'POST', `/conversations/${encodeURIComponent(input.conversationId)}/claim`, envelope(context, { claimant: 'ai', latest_message_id: latest, ttl_seconds: CLAIM_TTL_SECONDS }, `${input.idempotencyKey}_claim`, input.correlation));
  if (claim.claimed !== true || !asString(claim.claim_id)) throw readError(409, claim, null);
  return send(context, { conversation_id: input.conversationId, claim_id: asString(claim.claim_id), topic: input.topic, type: 'text', body: input.text }, input);
};

// Without on_behalf_of a template is a notification, which InventiveChat holds back (423) while a teammate is chatting.
export const sendTemplateToConversation = (context: InventiveChatContext, input: Send & { conversationId: string; template: TemplateMessage; member?: StaffMember }) =>
  send(context, { conversation_id: input.conversationId, ...templatePayload(input.template), ...onBehalfOf(input.member) }, input);

// Starts or reuses the conversation with a number; the first message to a customer is always a template.
export const sendTemplateToPhone = async (context: InventiveChatContext, input: Send & { to: string; whatsappAccountId: string | null; template: TemplateMessage; member?: StaffMember }) =>
  readSend(
    await call<Record<string, unknown>>(
      context.key,
      'POST',
      '/messages/send-to-phone',
      envelope(context, { to: input.to, ...(input.whatsappAccountId ? { whatsapp_account_id: input.whatsappAccountId } : {}), ...templatePayload(input.template), ...onBehalfOf(input.member) }, input.idempotencyKey, input.correlation),
    ),
  );

// The CRM is the source of marketing consent; a STOP sent on WhatsApp still wins there until the customer sends START.
export const recordConsent = async (context: InventiveChatContext, { phone, consent, givenAt, proof }: { phone: string; consent: boolean; givenAt?: string; proof?: string }) => {
  const body = await call<Record<string, unknown>>(
    context.key,
    'POST',
    '/contacts/consent',
    envelope(context, { phone, consent, source: 'crm', ...(givenAt ? { given_at: givenAt } : {}), ...(proof ? { proof: proof.slice(0, 500) } : {}) }, `crm_consent_${phone.replace(/\D/g, '')}_${consent ? 'yes' : 'no'}_${randomUUID()}`),
  );
  return { marketingAllowed: body.marketing_allowed === true };
};

export const WEBHOOK_HEADERS = ['x-event-id', 'x-event-type', 'x-signature-timestamp', 'x-signature-256'];

export const verifyWebhook = (secret: string | null, rawBody: string, headers: Record<string, string | undefined>, nowSeconds?: number) =>
  verifyBodySignature({ secret, timestamp: headers['x-signature-timestamp'], signature: headers['x-signature-256'], rawBody, nowSeconds });

export type WebhookMessage = {
  conversationId: string;
  messageId: string;
  phone: string | null;
  waId: string | null;
  profileName: string | null;
  direction: MessageDirection;
  fromBusinessPhone: boolean;
  senderName: string | null;
  senderMemberId: string | null;
  messageType: MessageType;
  text: string | null;
  templateName: string | null;
  mediaKind: string | null;
  attachmentId: string | null;
  mediaFilename: string | null;
  status: MessageStatus | null;
  error: string | null;
  occurredAt: string;
  idempotencyKey: string | null;
  importedFromHistory: boolean;
};

export type ConversationState = {
  conversationId: string;
  phone: string | null;
  waId: string | null;
  profileName: string | null;
  handling: ConversationHandling | null;
  personActive: boolean;
  closed: boolean;
  customerWaiting: boolean | null;
  aiPausedUntil: string | null;
};

export type WebhookEvent =
  | { kind: 'message'; eventType: string; message: WebhookMessage }
  | { kind: 'outcome_unknown'; message: WebhookMessage }
  | { kind: 'handling'; conversationId: string; handling: ConversationHandling }
  | { kind: 'conversation_state'; state: ConversationState }
  | { kind: 'opted_out'; conversationId: string | null; phone: string | null }
  | { kind: 'consent'; phone: string | null; consent: boolean; optedOut: boolean | null }
  | { kind: 'ignored'; eventType: string };

export type ParsedWebhook = { tenantId: string; correlationId: string | null; event: WebhookEvent };

const STATUS_MAP: Record<string, MessageStatus> = { queued: 'QUEUED', accepted: 'QUEUED', pending: 'QUEUED', sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED', undeliverable: 'FAILED' };
const TYPE_MAP: Record<string, MessageType> = { text: 'TEXT', template: 'TEMPLATE', media: 'MEDIA', image: 'MEDIA', video: 'MEDIA', audio: 'MEDIA', voice: 'MEDIA', document: 'MEDIA', sticker: 'MEDIA', buttons: 'BUTTONS', button: 'BUTTONS', interactive: 'BUTTONS' };
const HANDLING_MAP: Record<string, ConversationHandling> = {
  'conversation.human_takeover': 'PERSON',
  'conversation.handoff_requested': 'HANDOFF_REQUESTED',
  'conversation.ai_resumed': 'AI',
  'conversation.ai_approved': 'AI',
};
const SENDER_NAMES: Record<string, string> = { ai: 'InventiveChat AI', agent: 'InventiveChat AI', system: 'InventiveChat', automation: 'InventiveChat' };

const isoOr = <TFallback extends string | null>(value: unknown, fallback: TFallback) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : fallback);

// The customer is the WhatsApp id: digits without "+".
const customerOf = (value: unknown) => {
  const phone = normalisePhone(typeof value === 'string' || typeof value === 'number' ? value : asRecord(value).wa_id);
  return { phone, waId: phone ? phone.slice(1) : null };
};

// Meta's errors array; its first entry says why a message failed.
const failureOf = (errors: unknown) => {
  const first = asRecord(Array.isArray(errors) ? errors[0] : null);
  return asString(first.title) && asString(first.message) && first.title !== first.message ? `${asString(first.title)}: ${asString(first.message)}` : asString(first.title) || asString(first.message) || null;
};

const readMessage = (data: Record<string, unknown>, occurredAt: string): WebhookMessage | null => {
  const message = asRecord(data.message);
  const attachment = asRecord(message.attachment);
  const template = asRecord(message.template);
  const sender = asRecord(message.sender);
  const conversationId = asString(message.conversation_id);
  const messageId = asString(message.id);
  if (!conversationId || !messageId) return null;
  const customer = customerOf(message.customer);
  const rawDirection = asString(message.direction).toLowerCase();
  const direction: MessageDirection = rawDirection === 'inbound' ? 'INBOUND' : 'OUTBOUND';
  const crmMember = /^crm:(.+)$/.exec(asString(sender.id))?.[1];
  const status = asString(data.status ?? message.status).toLowerCase();
  const text = message.text;
  return {
    conversationId,
    messageId,
    phone: customer.phone,
    waId: customer.waId,
    profileName: asString(message.profile_name) || null,
    direction,
    fromBusinessPhone: rawDirection === 'echo',
    senderName: direction === 'INBOUND' ? null : rawDirection === 'echo' ? asString(sender.name) || 'Business phone' : asString(sender.name) || SENDER_NAMES[asString(sender.type).toLowerCase()] || 'InventiveChat',
    senderMemberId: crmMember && isUuid(crmMember) ? crmMember : null,
    messageType: TYPE_MAP[asString(message.type).toLowerCase()] ?? (attachment.id ? 'MEDIA' : 'OTHER'),
    text: (typeof text === 'string' ? text : asString(asRecord(text).body)) || null,
    templateName: asString(template.name) || null,
    mediaKind: attachment.voice === true ? 'voice' : asString(attachment.kind) || null,
    attachmentId: asString(attachment.id) || null,
    mediaFilename: asString(attachment.filename) || null,
    status: STATUS_MAP[status] ?? null,
    error: failureOf(data.errors ?? message.errors),
    occurredAt: isoOr(direction === 'INBOUND' ? (message.received_at ?? message.sent_at) : (message.sent_at ?? message.received_at), occurredAt),
    idempotencyKey: asString(message.idempotency_key) || null,
    importedFromHistory: message.imported_from_history === true,
  };
};

const conversationState = (data: Record<string, unknown>, now: number): ConversationState | null => {
  const conversationId = asString(data.conversation_id);
  if (!conversationId) return null;
  const customer = customerOf(data.customer);
  const state = asString(data.state).toUpperCase();
  const pausedUntil = isoOr(data.ai_paused_until, null);
  const personActive = state === 'HUMAN_ACTIVE' && (pausedUntil === null || Date.parse(pausedUntil) > now);
  const handling: ConversationHandling | null = data.automation_replying === true ? 'AI' : personActive ? 'PERSON' : state === 'AWAITING_APPROVAL' ? 'AWAITING_APPROVAL' : null;
  return {
    conversationId,
    phone: customer.phone,
    waId: customer.waId,
    profileName: asString(data.profile_name) || null,
    handling,
    personActive,
    closed: state === 'CLOSED',
    customerWaiting: typeof data.customer_waiting === 'boolean' ? data.customer_waiting : null,
    aiPausedUntil: pausedUntil,
  };
};

export const parseWebhook = (body: unknown, headerEventType?: string, now = Date.now()): ParsedWebhook | null => {
  const envelopeBody = asRecord(body);
  const payload = asRecord(envelopeBody.payload);
  const eventType = asString(payload.type) || headerEventType || '';
  const data = asRecord(payload.data);
  const tenantId = asString(envelopeBody.tenant_id);
  if (!tenantId || !eventType) return null;
  const occurredAt = isoOr(envelopeBody.occurred_at, new Date(now).toISOString());
  const result = (event: WebhookEvent): ParsedWebhook => ({ tenantId, correlationId: asString(envelopeBody.correlation_id) || null, event });
  switch (eventType) {
    case 'message.received':
    case 'message.sent':
    case 'message.status_updated': {
      const message = readMessage(data, occurredAt);
      return message ? result({ kind: 'message', eventType, message }) : null;
    }
    case 'message.send_outcome_unknown': {
      const message = readMessage(data, occurredAt);
      return message ? result({ kind: 'outcome_unknown', message }) : null;
    }
    case 'conversation.updated': {
      const state = conversationState(data, now);
      return state ? result({ kind: 'conversation_state', state }) : null;
    }
    case 'customer.opted_out':
      return result({ kind: 'opted_out', conversationId: asString(data.conversation_id) || null, phone: customerOf(data.customer).phone });
    case 'consent.updated':
      if (typeof data.consent !== 'boolean') return null;
      return result({ kind: 'consent', phone: customerOf(data.customer).phone, consent: data.consent, optedOut: typeof data.opted_out === 'boolean' ? data.opted_out : null });
    default: {
      const handling = HANDLING_MAP[eventType];
      const conversationId = asString(data.conversation_id);
      if (handling && conversationId) return result({ kind: 'handling', conversationId, handling });
      return result({ kind: 'ignored', eventType });
    }
  }
};
