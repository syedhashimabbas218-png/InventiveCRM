// Strict test double for the InventiveChat API (as InventiveChat confirmed it) and for the realtime hub's publish
// endpoint, for the throwaway test server only. Any request that does not match the contract is refused the way
// InventiveChat refuses it, so drift in the app fails the suite. It records every request and sends signed webhooks.
// Every genuine event also goes to the outbox read through the event feed; an outage switch withholds webhooks as if
// every retry had failed, and late retries can be delivered afterwards. Keys wa_test_loadNN_... are account ten_loadNN,
// with their own webhooks, conversations and feed, so many workspaces can share one double; other keys are ten_acme.
// Usage: [REALTIME_SECRET=...] node mock-inventivechat.mjs [port]
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8098);
const DEFAULT_TENANT = 'ten_acme';
const tenantOf = (key) => (/^wa_test_load(\d+)_/.exec(key ?? '') ? `ten_load${/^wa_test_load(\d+)_/.exec(key)[1]}` : DEFAULT_TENANT);
const tenantInfo = (id) => ({ id, name: id === DEFAULT_TENANT ? 'Acme Plumbing' : `Load test ${id}`, ai_sending_enabled: true });
const FEED_LIMIT = 500;
const EVENT_TYPES = ['message.received', 'message.sent', 'message.status_updated', 'message.send_outcome_unknown', 'conversation.ready_for_reply', 'conversation.human_takeover', 'conversation.handoff_requested', 'conversation.ai_resumed', 'conversation.ai_approved', 'conversation.updated', 'customer.opted_out', 'consent.updated', 'template.status_updated'];
const PAUSE_AFTER_HUMAN_MS = 4 * 3600 * 1000;
const number = (id, phone) => ({ id, display_phone_number: phone, phone_number_id: `pn_${id}`, verified_name: 'Acme Plumbing', connection_route: 'A', status: 'active', status_reason: null, has_access_token: true, quality_rating: 'GREEN', team_id: null, team_name: null });
const TEMPLATES = [
  { name: 'appointment_reminder', language: 'en_GB', category: 'utility', body: 'Hi {{customer_name}}, a reminder about your appointment on {{day}}.', parameters: ['customer_name', 'day'], quick_replies: ['Confirm', 'Reschedule'], status: 'approved', last_event: null },
  { name: 'invoice_ready', language: 'en_GB', category: 'utility', body: 'Hi {{customer_name}}, {{business_name}} sent invoice {{invoice_number}} for {{amount_due}}, due {{due_date}}: {{invoice_link}}', parameters: ['customer_name', 'business_name', 'invoice_number', 'amount_due', 'due_date', 'invoice_link'], quick_replies: [], status: 'approved', last_event: null },
  { name: 'spring_offer', language: 'en_GB', category: 'marketing', body: 'Hi {{first_name}}, {{discount}} off this spring.', parameters: ['first_name', 'discount'], quick_replies: ['Stop'], status: 'approved', last_event: null },
  { name: 'draft_template', language: 'en_GB', category: 'marketing', body: 'Not approved yet', parameters: [], quick_replies: [], status: 'pending', last_event: 'submitted' },
];

let log = [];
let publishes = [];
let subscriptions = [];
let failNext = [];
let unknownNext = [];
let emitted = [];
let outbox = [];
let outage = false;
let expiredThrough = 0;
// Cursors from an earlier run of the double are unknown here, as an expired one would be.
let feedEpoch = randomBytes(4).toString('hex');
let numbers = [number('wac_1', '+44 7700 900000')];
const replies = new Map();
const unknownKeys = new Set();
const conversations = new Map();
const messages = new Map();
const optedOut = new Set();
const allowedTopics = new Set();

const send = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

const reset = () => {
  log = [];
  subscriptions = [];
  publishes = [];
  failNext = [];
  unknownNext = [];
  emitted = [];
  outbox = [];
  outage = false;
  expiredThrough = 0;
  feedEpoch = randomBytes(4).toString('hex');
  numbers = [number('wac_1', '+44 7700 900000')];
  replies.clear();
  unknownKeys.clear();
  conversations.clear();
  messages.clear();
  optedOut.clear();
  allowedTopics.clear();
};

const keyOf = (request) => /^Bearer (wa_\S+)$/.exec(request.headers.authorization ?? '')?.[1] ?? null;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const E164 = /^\+[1-9]\d{6,14}$/;
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// Envelope problems are 400 { error: "invalid_envelope", details }; a foreign tenant or actor type is 403.
const envelopeRefusal = (body, tenant) => {
  if (!isObject(body)) return [400, { error: 'invalid_envelope', details: ['body must be an object'] }];
  const details = [];
  const allowed = ['tenant_id', 'actor', 'correlation_id', 'idempotency_key', 'occurred_at', 'payload'];
  for (const key of Object.keys(body)) if (!allowed.includes(key)) details.push(`unknown field ${key}`);
  if (typeof body.tenant_id !== 'string') details.push('tenant_id is required');
  if (!isObject(body.actor) || typeof body.actor.type !== 'string' || typeof body.actor.id !== 'string') details.push('actor must be { type, id }');
  if (typeof body.correlation_id !== 'string' || !/^cor_[A-Za-z0-9]{8,64}$/.test(body.correlation_id)) details.push('correlation_id must be cor_ and 8 to 64 letters or digits');
  if (typeof body.idempotency_key !== 'string' || body.idempotency_key.length < 1 || body.idempotency_key.length > 200 || /[\u0000-\u001f\u007f]/.test(body.idempotency_key)) details.push('idempotency_key must be 1 to 200 characters without control characters');
  if (typeof body.occurred_at !== 'string' || !ISO_WITH_ZONE.test(body.occurred_at) || Number.isNaN(Date.parse(body.occurred_at))) details.push('occurred_at must be an ISO date with a time zone');
  if (!isObject(body.payload)) details.push('payload must be an object');
  if (details.length) return [400, { error: 'invalid_envelope', details }];
  if (body.tenant_id !== tenant) return [403, { error: 'tenant_mismatch' }];
  if (body.actor.type !== 'system') return [403, { error: 'actor_not_allowed' }];
  return null;
};

const invalid = (errors) => [422, { reason: 'invalid_payload', errors }];

const onlyKeys = (payload, allowed, errors, prefix = '') => {
  for (const key of Object.keys(payload)) if (!allowed.includes(key)) errors.push(`${prefix}${key} is not allowed`);
};

const conversationFor = (phone, profileName = null, tenant = DEFAULT_TENANT) => {
  for (const conversation of conversations.values()) if (conversation.phone === phone && conversation.tenant === tenant) return conversation;
  const conversation = { id: `conv_${randomBytes(6).toString('hex')}`, tenant, phone, waId: phone.slice(1), profileName, lastInboundAt: null, latestInboundId: null, state: 'AWAITING_APPROVAL', automationApproved: false, aiPausedUntil: null, claims: new Map() };
  conversations.set(conversation.id, conversation);
  return conversation;
};

const windowOpen = (conversation) => Boolean(conversation.lastInboundAt && Date.now() - Date.parse(conversation.lastInboundAt) < 24 * 3600 * 1000);
const personActive = (conversation) => conversation.state === 'HUMAN_ACTIVE' && (conversation.aiPausedUntil === null || Date.parse(conversation.aiPausedUntil) > Date.now());

const messageObject = (message) => {
  const conversation = conversations.get(message.conversationId);
  return {
    id: message.id,
    conversation_id: message.conversationId,
    whatsapp_account_id: 'wac_1',
    customer: conversation.waId,
    profile_name: conversation.profileName,
    direction: message.direction,
    sender: message.sender,
    type: message.type,
    text: message.text ?? null,
    template: message.template ?? null,
    attachment: message.attachment ?? null,
    status: message.status,
    ai_topic: message.topic ?? null,
    imported_from_history: false,
    idempotency_key: message.idempotencyKey ?? null,
    sent_at: message.direction === 'inbound' ? null : message.at,
    received_at: message.direction === 'inbound' ? message.at : null,
  };
};

const conversationObject = (conversation) => ({
  conversation_id: conversation.id,
  whatsapp_account_id: 'wac_1',
  customer: conversation.waId,
  profile_name: conversation.profileName,
  state: conversation.state,
  automation_approved: conversation.automationApproved,
  automation_replying: conversation.state === 'AI_ACTIVE' && conversation.automationApproved,
  ai_paused_until: conversation.aiPausedUntil,
  customer_waiting: Boolean(conversation.lastInboundAt),
  last_message_at: conversation.lastInboundAt,
});

const sign = (secret, timestamp, raw) => `sha256=${createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')}`;

// Each attempt signs the same stored body afresh, as InventiveChat's retries do.
const deliver = async ({ tenant, type, eventId, raw }, { secret, timestamp = Math.floor(Date.now() / 1000), tamper = false } = {}) => {
  const results = [];
  for (const subscription of subscriptions.filter((entry) => entry.tenant === tenant && entry.status === 'active' && entry.event_types.includes(type))) {
    const headers = { 'Content-Type': 'application/json', 'X-Event-Id': eventId, 'X-Event-Type': type, 'X-Signature-Timestamp': String(timestamp), 'X-Signature-256': sign(secret ?? subscription.secret, timestamp, raw) };
    const body = tamper ? raw.replace('"payload"', '"payload" ') : raw;
    const response = await fetch(subscription.url, { method: 'POST', headers, body }).catch((error) => ({ status: 0, text: async () => error.message }));
    results.push({ url: subscription.url, status: response.status, body: await response.text(), sent: { headers, body } });
  }
  return results;
};

// Sends one signed webhook to every active subscription. Options let a test forge, age or alter it; only genuine
// events go to the outbox.
const emit = async (type, data, { tenant = DEFAULT_TENANT, secret, timestamp, tamper = false, eventId = `evt_${randomUUID()}`, actor = { type: 'system', id: 'inventivechat' }, correlationId = `cor_${randomBytes(8).toString('hex')}`, occurredAt = new Date().toISOString() } = {}) => {
  const raw = JSON.stringify({ tenant_id: tenant, actor, correlation_id: correlationId, idempotency_key: eventId, occurred_at: occurredAt, payload: { type, data } });
  const event = { seq: (outbox.at(-1)?.seq ?? expiredThrough) + 1, tenant, type, eventId, raw, delivered: false };
  const genuine = secret === undefined && timestamp === undefined && !tamper;
  if (genuine) outbox.push(event);
  const results = genuine && outage ? [] : await deliver(event, { secret, timestamp, tamper });
  event.delivered = results.length > 0;
  emitted.push({ tenant, type, data, actor, withheld: genuine && outage, results: results.map(({ url, status, body }) => ({ url, status, body })) });
  return results;
};

const cursorOf = (seq) => `evc_${feedEpoch}_${seq}`;
const seqOf = (cursor) => {
  const match = /^evc_([0-9a-f]+)_(\d+)$/.exec(cursor);
  return match && match[1] === feedEpoch ? Number(match[2]) : null;
};

// GET /v1/events/feed: the tenant's events in commit order as { cursor, event }. Without after it starts at the oldest
// kept; after=latest answers the newest position; next_cursor is the last event's cursor, the given after on an empty
// page, or null.
const handleFeed = (query, tenant) => {
  const limit = query.has('limit') ? Number(query.get('limit')) : 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > FEED_LIMIT) return invalid([`limit must be 1 to ${FEED_LIMIT}`]);
  if (query.get('after') === 'latest') return [200, { events: [], next_cursor: cursorOf(outbox.at(-1)?.seq ?? expiredThrough), has_more: false }];
  let after = expiredThrough;
  if (query.has('after')) {
    if (!/^evc_[0-9a-f]+_\d+$/.test(query.get('after'))) return invalid(['after is not a cursor']);
    after = seqOf(query.get('after'));
    if (after === null || after < expiredThrough || after > (outbox.at(-1)?.seq ?? expiredThrough)) return [410, { reason: 'cursor_expired', detail: 'Events after this cursor were pruned.' }];
  }
  const own = outbox.filter((event) => event.tenant === tenant && event.seq > after);
  const page = own.slice(0, limit);
  const nextCursor = page.length ? cursorOf(page.at(-1).seq) : query.get('after');
  return [200, { events: page.map((event) => ({ cursor: cursorOf(event.seq), event: JSON.parse(event.raw) })), next_cursor: nextCursor, has_more: own.length > page.length }];
};

const takeFailure = (path) => {
  const index = failNext.findIndex((failure) => path.startsWith(failure.path));
  return index < 0 ? null : failNext.splice(index, 1)[0];
};

const checkTemplate = (template, errors) => {
  if (!isObject(template)) return errors.push('template must be an object');
  onlyKeys(template, ['name', 'language_code', 'parameters'], errors, 'template.');
  const known = TEMPLATES.find((entry) => entry.name === template.name && entry.language === template.language_code);
  if (!known) return errors.push(`template ${template.name} (${template.language_code}) does not exist`);
  if (known.status !== 'approved') return errors.push(`template ${template.name} is ${known.status}, not approved`);
  if (!isObject(template.parameters)) return errors.push('template.parameters must be an object keyed by parameter name');
  for (const name of known.parameters) if (typeof template.parameters[name] !== 'string') errors.push(`template.parameters.${name} is required`);
  for (const name of Object.keys(template.parameters)) if (!known.parameters.includes(name)) errors.push(`template.parameters.${name} is not a parameter of ${known.name}`);
};

const checkOnBehalfOf = (value, errors) => {
  if (value === undefined) return;
  if (!isObject(value) || typeof value.crm_member_id !== 'string' || typeof value.name !== 'string') errors.push('on_behalf_of must be { crm_member_id, name }');
  else onlyKeys(value, ['crm_member_id', 'name'], errors, 'on_behalf_of.');
};

const recordReply = (key, body) => {
  replies.set(key, body);
  return body;
};

const outbound = (conversation, payload, envelopeBody) => {
  const human = payload.on_behalf_of;
  const sender = human ? { type: 'human', id: `crm:${human.crm_member_id}`, name: human.name } : payload.claim_id ? { type: 'ai', id: 'automation', name: 'Automation' } : { type: 'system', id: envelopeBody.actor.id, name: 'Notifications' };
  const message = { id: `msg_${randomBytes(6).toString('hex')}`, conversationId: conversation.id, direction: 'outbound', sender, type: payload.type, text: payload.body, template: payload.template, topic: payload.topic, status: 'sent', at: new Date().toISOString(), idempotencyKey: envelopeBody.idempotency_key };
  messages.set(message.id, message);
  // A person replying takes the conversation over and pauses the AI and notifications.
  if (human) {
    conversation.state = 'HUMAN_ACTIVE';
    conversation.aiPausedUntil = new Date(Date.now() + PAUSE_AFTER_HUMAN_MS).toISOString();
    conversation.claims.clear();
  }
  return message;
};

const humanActiveRefusal = (conversation) => {
  const retry = conversation.aiPausedUntil ? Math.max(1, Math.ceil((Date.parse(conversation.aiPausedUntil) - Date.now()) / 1000)) : null;
  return [423, { reason: 'human_active', paused_until: conversation.aiPausedUntil, retry_after_seconds: retry }];
};

const handleSend = (envelopeBody, toPhone, tenant) => {
  const payload = envelopeBody.payload;
  const replay = replies.get(envelopeBody.idempotency_key);
  if (replay) return [200, { ...replay, replayed: true }];
  // At most once: a key whose outcome is unknown never goes out again.
  if (unknownKeys.has(envelopeBody.idempotency_key)) return [409, { reason: 'outcome_unknown' }];
  const errors = [];
  if (toPhone) {
    onlyKeys(payload, ['to', 'whatsapp_account_id', 'type', 'template', 'body', 'on_behalf_of'], errors);
    if (typeof payload.to !== 'string' || !E164.test(payload.to)) errors.push('to must be an E.164 number');
    if (payload.whatsapp_account_id !== undefined && !numbers.some((entry) => entry.id === payload.whatsapp_account_id)) errors.push('whatsapp_account_id is unknown');
  } else {
    onlyKeys(payload, ['conversation_id', 'type', 'body', 'template', 'on_behalf_of', 'claim_id', 'topic'], errors);
    if (typeof payload.conversation_id !== 'string') errors.push('conversation_id is required');
  }
  if (!['text', 'template'].includes(payload.type)) errors.push('type must be text or template');
  if (payload.type === 'text' && (typeof payload.body !== 'string' || !payload.body.trim())) errors.push('body is required for text');
  if (payload.type === 'text' && payload.template !== undefined) errors.push('template is not allowed for text');
  if (payload.type === 'template') {
    checkTemplate(payload.template, errors);
    if (payload.body !== undefined) errors.push('body is not allowed for a template');
    if (payload.claim_id !== undefined || payload.topic !== undefined) errors.push('claim_id and topic are only for automation text');
  }
  checkOnBehalfOf(payload.on_behalf_of, errors);
  if (payload.on_behalf_of && (payload.claim_id !== undefined || payload.topic !== undefined)) errors.push('on_behalf_of cannot be combined with a claim');
  if (errors.length) return invalid(errors);

  let conversation;
  if (toPhone) {
    if (payload.type === 'text') return [422, { reason: 'outside_window' }];
    const active = numbers.filter((entry) => entry.status === 'active');
    if (active.length > 1 && !payload.whatsapp_account_id) return [422, { reason: 'whatsapp_account_id_required' }];
    conversation = conversationFor(payload.to, null, tenant);
  } else {
    conversation = conversations.get(payload.conversation_id);
    if (!conversation || conversation.tenant !== tenant) return [404, { reason: 'conversation_not_found' }];
  }
  if (optedOut.has(conversation.phone)) return [409, { reason: 'opted_out' }];
  if (payload.type === 'text' && !windowOpen(conversation)) return [422, { reason: 'outside_window' }];
  if (payload.type === 'text' && !payload.on_behalf_of) {
    if (typeof payload.claim_id !== 'string') return invalid(['claim_id is required for automation text']);
    // A claim stays held after a send, refused or not, until it expires, is released, or a new inbound message, a
    // takeover or a pause clears it.
    const claim = conversation.claims.get(payload.claim_id);
    if (!claim || Date.parse(claim.expiresAt) < Date.now()) return [409, { reason: 'claim_invalid' }];
    if (typeof payload.topic !== 'string' || !allowedTopics.has(payload.topic)) return [422, { reason: 'out_of_scope', allowed_topics: [...allowedTopics], action: 'handoff' }];
  }
  if (payload.type === 'template' && !payload.on_behalf_of && personActive(conversation)) return humanActiveRefusal(conversation);
  const unknown = unknownNext.shift();
  if (unknown) {
    unknownKeys.add(envelopeBody.idempotency_key);
    const data = { conversation_id: conversation.id, idempotency_key: envelopeBody.idempotency_key, detail: unknown.crash ? 'The sending process stopped mid-send.' : 'Meta did not answer in time.' };
    // A crash is reported by InventiveChat itself a little later; a Meta timeout carries the caller's actor and correlation.
    const options = unknown.crash ? { eventId: `message.send_outcome_unknown:${envelopeBody.idempotency_key}`, actor: { type: 'system', id: 'messaging-service' } } : { eventId: `message.send_outcome_unknown:${envelopeBody.idempotency_key}`, actor: envelopeBody.actor, correlationId: envelopeBody.correlation_id };
    setTimeout(() => void emit('message.send_outcome_unknown', data, { ...options, tenant: conversation.tenant }), unknown.crash ? 1500 : 300);
    return unknown.crash ? ['crash'] : [502, { reason: 'outcome_unknown' }];
  }
  const message = outbound(conversation, payload, envelopeBody);
  return [200, recordReply(envelopeBody.idempotency_key, { conversation_id: conversation.id, message_id: message.id })];
};

const handleClaim = (conversationId, envelopeBody) => {
  const payload = envelopeBody.payload;
  const errors = [];
  onlyKeys(payload, ['claimant', 'latest_message_id', 'ttl_seconds'], errors);
  if (payload.claimant !== 'ai') errors.push('claimant must be ai');
  if (typeof payload.latest_message_id !== 'string' && payload.latest_message_id !== null) errors.push('latest_message_id must be a message id or null');
  if (payload.ttl_seconds !== undefined && (!Number.isInteger(payload.ttl_seconds) || payload.ttl_seconds < 1 || payload.ttl_seconds > 300)) errors.push('ttl_seconds must be 1 to 300');
  if (errors.length) return invalid(errors);
  const conversation = conversations.get(conversationId);
  if (!conversation) return [404, { reason: 'conversation_not_found' }];
  if (!conversation.automationApproved) return [409, { reason: 'awaiting_approval' }];
  if (personActive(conversation)) return [409, { reason: 'human_active', paused_until: conversation.aiPausedUntil, retry_after_seconds: null }];
  if (payload.latest_message_id !== conversation.latestInboundId) return [409, { reason: 'newer_message' }];
  if ([...conversation.claims.values()].some((claim) => Date.parse(claim.expiresAt) > Date.now())) return [409, { reason: 'already_claimed' }];
  const claim = { id: `clm_${randomBytes(6).toString('hex')}`, expiresAt: new Date(Date.now() + (payload.ttl_seconds ?? 120) * 1000).toISOString() };
  conversation.claims.set(claim.id, claim);
  return [200, { claimed: true, claim_id: claim.id, expires_at: claim.expiresAt }];
};

// Always 200, even for a claim that already ended or is not this conversation's.
const handleRelease = (conversationId, envelopeBody) => {
  const errors = [];
  onlyKeys(envelopeBody.payload, ['claim_id'], errors);
  if (typeof envelopeBody.payload.claim_id !== 'string') errors.push('claim_id is required');
  if (errors.length) return invalid(errors);
  conversations.get(conversationId)?.claims.delete(envelopeBody.payload.claim_id);
  return [200, { released: true }];
};

const handleConsent = (envelopeBody) => {
  const payload = envelopeBody.payload;
  const errors = [];
  onlyKeys(payload, ['phone', 'consent', 'source', 'given_at', 'proof'], errors);
  if (typeof payload.phone !== 'string' || !E164.test(payload.phone)) errors.push('phone must be an E.164 number');
  if (typeof payload.consent !== 'boolean') errors.push('consent must be true or false');
  if (payload.source !== 'crm') errors.push('source must be crm');
  if (payload.given_at !== undefined && (typeof payload.given_at !== 'string' || !ISO_WITH_ZONE.test(payload.given_at))) errors.push('given_at must be an ISO date with a time zone');
  if (payload.proof !== undefined && (typeof payload.proof !== 'string' || payload.proof.length > 1000)) errors.push('proof must be text');
  if (errors.length) return invalid(errors);
  return [200, { phone: payload.phone, consent: payload.consent, marketing_allowed: payload.consent && !optedOut.has(payload.phone) }];
};

const handleSubscription = (envelopeBody, tenant) => {
  const payload = envelopeBody.payload;
  const errors = [];
  onlyKeys(payload, ['url', 'event_types'], errors);
  if (typeof payload.url !== 'string' || !/^https?:\/\//.test(payload.url)) errors.push('url must be an http(s) address');
  if (!Array.isArray(payload.event_types) || payload.event_types.length === 0) errors.push('event_types must be a non-empty list');
  else for (const type of payload.event_types) if (!EVENT_TYPES.includes(type)) errors.push(`event type ${type} is unknown`);
  if (errors.length) return invalid(errors);
  if (subscriptions.filter((entry) => entry.tenant === tenant && entry.status === 'active').length >= 10) return [422, { reason: 'too_many_subscriptions' }];
  const subscription = { id: `sub_${randomBytes(4).toString('hex')}`, tenant, url: payload.url, event_types: payload.event_types, status: 'active', created_at: new Date().toISOString(), secret: `whsec_${randomBytes(24).toString('hex')}` };
  subscriptions.push(subscription);
  return [201, { id: subscription.id, secret: subscription.secret, note: 'Store the secret now; it is not shown again.' }];
};

const setState = async (conversation, changes) => {
  Object.assign(conversation, changes);
  if (conversation.state === 'HUMAN_ACTIVE' || conversation.aiPausedUntil) conversation.claims.clear();
  return emit('conversation.updated', conversationObject(conversation), { tenant: conversation.tenant });
};

createServer(async (request, response) => {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    return send(response, 400, { error: 'invalid_envelope', details: ['body is not JSON'] });
  }
  const url = new URL(request.url, 'http://mock');
  const path = url.pathname;
  log.push({ method: request.method, path, body, tenant: keyOf(request) ? tenantOf(keyOf(request)) : null, at: new Date().toISOString() });

  if (path.startsWith('/admin/')) {
    if (path === '/admin/reset') {
      reset();
      return send(response, 200, { ok: true });
    }
    if (path === '/admin/log') return send(response, 200, log);
    if (path === '/admin/publishes') return send(response, 200, publishes);
    if (path === '/admin/emitted') return send(response, 200, emitted);
    // The CRM is unreachable: webhooks are withheld as if every retry failed, and still go to the outbox.
    if (path === '/admin/outage') {
      outage = body?.on === true;
      return send(response, 200, { outage });
    }
    // InventiveChat's longer retries arriving after the CRM caught up, optionally newest first.
    if (path === '/admin/late-retries') {
      const pending = outbox.filter((event) => !event.delivered);
      const results = [];
      for (const event of body?.newestFirst ? [...pending].reverse() : pending) {
        const delivered = await deliver(event);
        event.delivered = delivered.length > 0;
        results.push({ type: event.type, eventId: event.eventId, results: delivered.map(({ status, body: answer }) => ({ status, body: answer })) });
      }
      return send(response, 200, { results });
    }
    // Events older than the retention window drop out of the feed.
    if (path === '/admin/expire') {
      expiredThrough = outbox.at(-1)?.seq ?? expiredThrough;
      outbox = [];
      return send(response, 200, { expiredThrough });
    }
    if (path === '/admin/feed') {
      const own = outbox.filter((event) => !body?.tenant || event.tenant === body.tenant);
      return send(response, 200, { count: own.length, withheld: own.filter((event) => !event.delivered).length });
    }
    // The next send that would go out ends with its outcome unknown: a Meta timeout (502) or a crash mid-send.
    if (path === '/admin/unknown-next') {
      unknownNext.push({ crash: body?.crash === true });
      return send(response, 200, { ok: true });
    }
    if (path === '/admin/claims') {
      const conversation = conversations.get(body?.conversationId);
      return send(response, 200, conversation ? [...conversation.claims.values()].filter((claim) => Date.parse(claim.expiresAt) > Date.now()) : []);
    }
    if (path === '/admin/subscriptions') return send(response, 200, subscriptions.map(({ secret: _secret, ...entry }) => entry));
    if (path === '/admin/fail-next') {
      failNext.push({ path: body.path, status: body.status, body: body.body });
      return send(response, 200, { ok: true });
    }
    if (path === '/admin/second-number') {
      numbers.push(number('wac_2', '+44 7700 900999'));
      return send(response, 200, { ok: true });
    }
    if (path === '/admin/allow-topic') {
      allowedTopics.add(body.topic);
      return send(response, 200, { ok: true });
    }
    if (path === '/admin/opt-out') {
      optedOut.add(body.phone);
      return send(response, 200, { ok: true });
    }
    // A person approves automation for one conversation, as InventiveChat requires by default.
    if (path === '/admin/approve') {
      const conversation = conversations.get(body.conversationId);
      return send(response, 200, { results: await setState(conversation, { automationApproved: true, state: 'AI_ACTIVE', aiPausedUntil: null }) });
    }
    // A teammate takes the customer over, with no time limit unless one is given, and later hands back.
    if (path === '/admin/takeover') {
      const conversation = conversationFor(body.phone, null, body.tenant ?? DEFAULT_TENANT);
      return send(response, 200, { conversationId: conversation.id, results: await setState(conversation, { state: 'HUMAN_ACTIVE', aiPausedUntil: body.pausedUntil ?? null }) });
    }
    if (path === '/admin/hand-back') {
      const conversation = conversationFor(body.phone, null, body.tenant ?? DEFAULT_TENANT);
      return send(response, 200, { results: await setState(conversation, { state: 'AI_ACTIVE', aiPausedUntil: null }) });
    }
    // A customer writes: the conversation is created or reused and message.received goes to the app.
    if (path === '/admin/inbound') {
      const conversation = conversationFor(body.phone, body.profileName ?? null, body.tenant ?? DEFAULT_TENANT);
      conversation.profileName = body.profileName ?? conversation.profileName;
      const at = body.at ?? new Date().toISOString();
      if (!conversation.lastInboundAt || at > conversation.lastInboundAt) conversation.lastInboundAt = at;
      const message = { id: `msg_${randomBytes(6).toString('hex')}`, conversationId: conversation.id, direction: 'inbound', sender: { type: 'customer', id: conversation.waId, name: conversation.profileName }, type: body.type ?? 'text', text: body.text, attachment: body.attachment, status: 'delivered', at };
      messages.set(message.id, message);
      conversation.latestInboundId = message.id;
      conversation.claims.clear();
      const results = await emit('message.received', { message: messageObject(message) }, { ...body.sign, tenant: conversation.tenant });
      return send(response, 200, { conversationId: conversation.id, messageId: message.id, results });
    }
    if (path === '/admin/status') {
      const message = messages.get(body.messageId);
      if (!message) return send(response, 404, { error: 'unknown message' });
      message.status = body.status;
      const errors = body.status === 'failed' ? [{ code: 131026, title: 'Message undeliverable', message: body.error ?? 'Receiver is not on WhatsApp', error_data: { details: 'Test failure' } }] : undefined;
      return send(response, 200, { results: await emit('message.status_updated', { message: messageObject(message), status: body.status, ...(errors ? { errors } : {}) }, { tenant: conversations.get(message.conversationId)?.tenant }) });
    }
    if (path === '/admin/emit') return send(response, 200, { results: await emit(body.type, body.data, { ...body.sign, tenant: body.tenant ?? DEFAULT_TENANT, ...(body.occurredAt ? { occurredAt: body.occurredAt } : {}) }) });
  }

  // The realtime hub's publish endpoint, so the suite can see what the app announced.
  if (path === '/v1/publish' && request.method === 'POST') {
    const secret = process.env.REALTIME_SECRET;
    const valid = secret ? request.headers['x-realtime-signature'] === sign(secret, request.headers['x-realtime-timestamp'], raw) : null;
    publishes.push({ ...body, validSignature: valid, at: new Date().toISOString() });
    return send(response, valid === false ? 401 : 200, { ok: valid !== false });
  }

  const key = keyOf(request);
  if (!key || !key.startsWith('wa_test_')) return send(response, 401, { error: 'unauthenticated' });
  const tenant = tenantOf(key);
  const failure = takeFailure(path);
  if (failure) return send(response, failure.status, failure.body);
  if (request.method === 'POST') {
    const refusal = envelopeRefusal(body, tenant);
    if (refusal) return send(response, ...refusal);
  }

  if (request.method === 'GET' && path === '/v1/account')
    return send(response, 200, { tenant: tenantInfo(tenant), platform_ai_sending_enabled: true, settings: { ai_requires_approval: true, ai_allowed_topics: [...allowedTopics], ai_scope_instructions: '' }, numbers, permissions: { business_owner: false, owned_team_ids: [] } });
  if (request.method === 'GET' && path === '/v1/templates') return send(response, 200, { templates: TEMPLATES });
  if (request.method === 'GET' && path === '/v1/events/feed') return send(response, ...handleFeed(url.searchParams, tenant));
  if (request.method === 'GET' && path === '/v1/subscriptions') return send(response, 200, { subscriptions: subscriptions.filter((entry) => entry.tenant === tenant).map(({ id, url: endpoint, event_types, status, created_at }) => ({ id, url: endpoint, event_types, status, created_at })) });
  if (request.method === 'POST' && path === '/v1/subscriptions') return send(response, ...handleSubscription(body, tenant));
  const disable = /^\/v1\/subscriptions\/([^/]+)\/disable$/.exec(path);
  if (request.method === 'POST' && disable) {
    if (Object.keys(body.payload).length) return send(response, ...invalid(['payload must be empty']));
    const subscription = subscriptions.find((entry) => entry.id === disable[1] && entry.tenant === tenant);
    if (!subscription) return send(response, 404, { reason: 'subscription_not_found' });
    subscription.status = 'disabled';
    return send(response, 200, { id: subscription.id, status: 'disabled' });
  }
  if (request.method === 'POST' && (path === '/v1/messages/send' || path === '/v1/messages/send-to-phone')) {
    const answer = handleSend(body, path.endsWith('send-to-phone'), tenant);
    if (answer[0] === 'crash') return request.socket.destroy();
    return send(response, ...answer);
  }
  const claim = /^\/v1\/conversations\/([^/]+)\/claim$/.exec(path);
  if (request.method === 'POST' && claim) return send(response, ...handleClaim(claim[1], body));
  const release = /^\/v1\/conversations\/([^/]+)\/release$/.exec(path);
  if (request.method === 'POST' && release) return send(response, ...handleRelease(release[1], body));
  const conversationPath = /^\/v1\/conversations\/([^/]+)$/.exec(path);
  if (request.method === 'GET' && conversationPath) {
    const conversation = conversations.get(conversationPath[1]);
    return conversation ? send(response, 200, { id: conversation.id, ...conversationObject(conversation), latest_message_id: conversation.latestInboundId }) : send(response, 404, { reason: 'conversation_not_found' });
  }
  if (request.method === 'POST' && path === '/v1/contacts/consent') return send(response, ...handleConsent(body));
  const contact = /^\/v1\/contacts\/([^/]+)$/.exec(path);
  if (request.method === 'GET' && contact) {
    const phone = decodeURIComponent(contact[1]);
    return send(response, 200, { phone, opted_out: optedOut.has(phone), conversations: [...conversations.values()].filter((entry) => entry.phone === phone).map((entry) => entry.id) });
  }
  send(response, 404, { reason: 'not_found' });
}).listen(port, '127.0.0.1', () => console.log(`mock inventivechat on ${port}`));
