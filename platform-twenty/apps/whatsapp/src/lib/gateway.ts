import { CAMPAIGN_EVENT, CAMPAIGN_KEY_PREFIX } from 'src/lib/callbacks';
import { describeError, findTemplate, InventiveChatError, type InventiveChatContext, type InventiveChatTemplate, listTemplates, namedParameters, recordConsent, type TemplateMessage, withRetry } from 'src/lib/inventivechat';
import { isE164, normalisePhone } from 'src/lib/phones';
import { type ChangeSet } from 'src/lib/realtime';
import { messagesByDeliveryIds } from 'src/lib/records';
import { isLanguageCode, isTemplateName, isUuid, MAX_TEMPLATE_PARAMETERS } from 'src/lib/rules';
import { deferGatewayTemplate, type GatewayOutcome, sendGatewayTemplate } from 'src/lib/sending';
import { isOwnCallbackUrl, type Settings } from 'src/lib/settings';

// Implements apps/commercial-docs/WHATSAPP_HANDOFF.md, so the other apps can point WHATSAPP_GATEWAY_URL here unchanged.

// Which template an event uses, and which field of the request fills each of the template's named parameters.
export type TemplateMapping = { name: string; language?: string; parameters: Record<string, string> };

const CUSTOMER = { customer_name: 'recipient.firstName', business_name: 'business.name' };

// Used when WhatsApp settings do not map an event; the README lists them so templates can be created to match.
export const DEFAULT_GATEWAY_TEMPLATES: Record<string, TemplateMapping> = {
  'invoice.send': { name: 'invoice_ready', parameters: { ...CUSTOMER, invoice_number: 'document.number', amount_due: 'document.amountDue', due_date: 'document.dueDate', invoice_link: 'document.pdf.url' } },
  'credit_note.send': { name: 'credit_note_ready', parameters: { ...CUSTOMER, credit_note_number: 'document.number', amount: 'document.total', document_link: 'document.pdf.url' } },
  'quote.send': { name: 'quote_ready', parameters: { ...CUSTOMER, quote_number: 'document.number', total: 'document.total', valid_until: 'document.validUntil', quote_link: 'document.pdf.url' } },
  'invoice.overdue_reminder': { name: 'invoice_overdue', parameters: { ...CUSTOMER, invoice_number: 'document.number', amount_due: 'document.amountDue', due_date: 'document.dueDate', payment_link: 'document.paymentUrl' } },
  'invoice.payment_link': { name: 'invoice_payment_link', parameters: { ...CUSTOMER, invoice_number: 'document.number', amount_due: 'document.amountDue', payment_link: 'document.paymentUrl' } },
  'feedback.survey': { name: 'feedback_request', parameters: { ...CUSTOMER, survey_link: 'survey.url' } },
};

export type CampaignItem = { recipientId: string; deliveryKey: string; phone: string; variables: string[] };
export type ReadyCampaignItem = { recipientId: string; deliveryKey: string; phone: string; template: TemplateMessage };

export type GatewayPlan =
  | { kind: 'single'; event: string; deliveryKey: string; phone: string; mapping: TemplateMapping; request: Record<string, unknown>; statusCallbackUrl: string | null; label: string }
  | { kind: 'campaign'; campaignId: string; batchId: string; templateName: string; language: string | null; items: CampaignItem[]; rejected: string[]; statusCallbackUrl: string | null }
  | { kind: 'error'; status: number; error: string };

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

const LABELS: [RegExp, string][] = [
  [/^(invoice|quote|credit_note)\./, 'Quotes & Invoices'],
  [/^feedback\./, 'Feedback'],
  [/^campaign\./, 'Campaign Studio'],
];

export const labelFor = (event: string) => LABELS.find(([pattern]) => pattern.test(event))?.[1] ?? 'Automation';

// A dotted path into the request. An amount object gives its formatted text, and "firstName" is read from "name"
// when the request has no such field (recipient.firstName).
export const resolvePath = (body: unknown, path: string) => {
  const parts = path.split('.');
  let parent: unknown = null;
  let value: unknown = body;
  for (const part of parts) {
    parent = value;
    value = asRecord(value)[part];
  }
  if (value === undefined && parts.at(-1) === 'firstName') value = (asRecord(parent).name as string | undefined)?.trim().split(/\s+/)[0];
  const formatted = asRecord(value).formatted;
  if (typeof formatted === 'string') return formatted;
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
};

const PATH = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;
const PARAMETER = /^[A-Za-z0-9_]{1,64}$/;

export const readMapping = (raw: unknown): Record<string, TemplateMapping> => {
  const parsed = typeof raw === 'string' ? (() => { try { return JSON.parse(raw) as unknown; } catch { return null; } })() : raw;
  const mapping: Record<string, TemplateMapping> = {};
  for (const [event, entry] of Object.entries(asRecord(parsed))) {
    const value = asRecord(entry);
    if (!isTemplateName(value.name)) continue;
    const parameters = Object.fromEntries(Object.entries(asRecord(value.parameters)).filter((pair): pair is [string, string] => PARAMETER.test(pair[0]) && typeof pair[1] === 'string' && PATH.test(pair[1])).slice(0, MAX_TEMPLATE_PARAMETERS));
    mapping[event] = { name: value.name, ...(isLanguageCode(value.language) ? { language: value.language } : {}), parameters };
  }
  return mapping;
};

export const effectiveMapping = (raw: unknown) => ({ ...DEFAULT_GATEWAY_TEMPLATES, ...readMapping(raw) });

const DELIVERY_ID = /^[A-Za-z0-9:_-]{1,100}$/;
const MAX_BATCH = 100;

const callbackOf = (value: unknown, origins: string[]): { ok: true; url: string | null } | { ok: false } => {
  if (value === undefined || value === null || value === '') return { ok: true, url: null };
  return isOwnCallbackUrl(value, origins) ? { ok: true, url: value } : { ok: false };
};

export const planGatewayRequest = (body: unknown, { mapping, origins }: { mapping: Record<string, TemplateMapping>; origins: string[] }): GatewayPlan => {
  const request = asRecord(body);
  const event = typeof request.event === 'string' ? request.event : '';
  if (!event) return { kind: 'error', status: 400, error: 'event is required.' };
  const callback = callbackOf(request.statusCallbackUrl, origins);
  if (!callback.ok) return { kind: 'error', status: 400, error: 'statusCallbackUrl must be an app route of this workspace.' };

  if (event === CAMPAIGN_EVENT) {
    const template = asRecord(request.template);
    const batchId = typeof request.batchId === 'string' && DELIVERY_ID.test(request.batchId) ? request.batchId : '';
    if (!batchId || !isTemplateName(template.name)) return { kind: 'error', status: 400, error: 'A campaign batch needs a batchId and a template name.' };
    const messages = Array.isArray(request.messages) ? request.messages : [];
    if (messages.length === 0 || messages.length > MAX_BATCH) return { kind: 'error', status: 400, error: `A campaign batch holds 1 to ${MAX_BATCH} messages.` };
    const items: CampaignItem[] = [];
    const rejected: string[] = [];
    const seen = new Set<string>();
    for (const entry of messages) {
      const message = asRecord(entry);
      if (!isUuid(message.recipientId) || seen.has(message.recipientId)) continue;
      seen.add(message.recipientId);
      const phone = typeof message.to === 'string' && message.to.startsWith('+') ? normalisePhone(message.to) : null;
      if (!phone) {
        rejected.push(message.recipientId);
        continue;
      }
      const variables = Array.isArray(message.variables) ? message.variables.slice(0, MAX_TEMPLATE_PARAMETERS).map((value) => (typeof value === 'string' || typeof value === 'number' ? String(value) : '')) : [];
      items.push({ recipientId: message.recipientId, deliveryKey: `${CAMPAIGN_KEY_PREFIX}${message.recipientId}`, phone, variables });
    }
    return { kind: 'campaign', campaignId: typeof request.campaignId === 'string' ? request.campaignId : '', batchId, templateName: template.name, language: isLanguageCode(template.language) ? template.language : null, items, rejected, statusCallbackUrl: callback.url };
  }

  const deliveryId = typeof request.deliveryId === 'string' && DELIVERY_ID.test(request.deliveryId) && !request.deliveryId.startsWith(CAMPAIGN_KEY_PREFIX) ? request.deliveryId : '';
  if (!deliveryId) return { kind: 'error', status: 400, error: 'deliveryId is required.' };
  const recipientPhone = asRecord(request.recipient).phone;
  const phone = typeof recipientPhone === 'string' && isE164(recipientPhone.replace(/[\s()-]/g, '')) ? normalisePhone(recipientPhone) : null;
  if (!phone) return { kind: 'error', status: 400, error: 'recipient.phone must be an international number such as +447700900123.' };
  const entry = mapping[event];
  if (!entry) return { kind: 'error', status: 422, error: `No WhatsApp template is set up for ${event}. Add one in WhatsApp settings, under "Templates for app notifications".` };
  return { kind: 'single', event, deliveryKey: deliveryId, phone, mapping: entry, request, statusCallbackUrl: callback.url, label: labelFor(event) };
};

// The template's own parameter names decide what is sent; each must be filled by the event's mapping.
export const resolveSingle = (plan: Extract<GatewayPlan, { kind: 'single' }>, templates: InventiveChatTemplate[], defaultLanguage: string): { template: TemplateMessage } | { error: string } => {
  const template = findTemplate(templates, plan.mapping.name, [plan.mapping.language, defaultLanguage]);
  if (!template) return { error: `The WhatsApp template ${plan.mapping.name} (for ${plan.event}) is not approved in InventiveChat.` };
  const missing = template.parameters.filter((name) => !plan.mapping.parameters[name]);
  if (missing.length) return { error: `The WhatsApp template ${template.name} needs ${missing.join(', ')}, which the mapping for ${plan.event} does not fill. Map them in WhatsApp settings.` };
  return { template: { name: template.name, languageCode: template.language, parameters: Object.fromEntries(template.parameters.map((name) => [name, resolvePath(plan.request, plan.mapping.parameters[name] as string)])) } };
};

// Campaign Studio sends values in order; they fill the template's named parameters in the template's order.
export const resolveCampaign = (plan: Extract<GatewayPlan, { kind: 'campaign' }>, templates: InventiveChatTemplate[], defaultLanguage: string): { items: ReadyCampaignItem[]; rejected: string[] } | { error: string } => {
  const template = findTemplate(templates, plan.templateName, [plan.language, defaultLanguage]);
  if (!template) return { error: `The WhatsApp template ${plan.templateName} is not approved in InventiveChat.` };
  const items: ReadyCampaignItem[] = [];
  const rejected = [...plan.rejected];
  for (const item of plan.items) {
    const { parameters, missing } = namedParameters(template, item.variables);
    if (missing.length) rejected.push(item.recipientId);
    else items.push({ recipientId: item.recipientId, deliveryKey: item.deliveryKey, phone: item.phone, template: { name: template.name, languageCode: template.language, parameters } });
  }
  return { items, rejected };
};

export type GatewayAnswer = { status: number; body: Record<string, unknown> };

const SINGLE_BUDGET_MS = 22_000;
const BATCH_BUDGET_MS = 20_000;
const CONCURRENT_SENDS = 3;

// A wait (a teammate chatting, Meta's limit) is reported as accepted and queued, not as a failure: the retry job sends
// it and the status callback follows.
export const answerForSingle = (outcome: GatewayOutcome): GatewayAnswer => {
  if (outcome.state === 'sent') return { status: 200, body: { messageId: outcome.messageId } };
  if (outcome.state === 'deferred') return { status: 202, body: { messageId: null, queued: true, retryAt: outcome.retryAt, reason: outcome.reason } };
  return { status: 422, body: { error: outcome.error } };
};

type ExistingRecord = { deliveryId: string | null; inventiveChatMessageId: string | null; status: string | null; retryAt: string | null };

// What a repeated batch already produced: sent and queued messages are accepted again without asking InventiveChat.
export const splitBatch = <TItem extends { recipientId: string; deliveryKey: string }>(items: TItem[], existing: ExistingRecord[], now = Date.now()) => {
  const byKey = new Map(existing.flatMap((record) => (record.deliveryId ? [[record.deliveryId, record] as const] : [])));
  const accepted: { recipientId: string; messageId: string | null }[] = [];
  const toSend: TItem[] = [];
  for (const item of items) {
    const record = byKey.get(item.deliveryKey);
    if (record?.inventiveChatMessageId) accepted.push({ recipientId: item.recipientId, messageId: record.inventiveChatMessageId });
    else if (record?.status === 'QUEUED' && record.retryAt && Date.parse(record.retryAt) > now) accepted.push({ recipientId: item.recipientId, messageId: null });
    else toSend.push(item);
  }
  return { accepted, toSend };
};

// Campaign Studio only sends to contacts with WhatsApp marketing consent; InventiveChat learns it from us first, and a
// STOP the customer sent on WhatsApp still wins there.
const recordConsents = async (context: InventiveChatContext, items: ReadyCampaignItem[], campaignId: string, deadline: number) => {
  const refused = new Set<string>();
  for (const phone of new Set(items.map((item) => item.phone))) {
    try {
      const { marketingAllowed } = await withRetry(() => recordConsent(context, { phone, consent: true, proof: `Agreed to WhatsApp marketing in InventiveCRM (campaign ${campaignId})` }), deadline);
      if (!marketingAllowed) refused.add(phone);
    } catch (error) {
      if (error instanceof InventiveChatError && error.code === 'opted_out') refused.add(phone);
      else console.error(`whatsapp gateway: consent not recorded: ${describeError(error)}`);
    }
  }
  return refused;
};

export const runGatewayPlan = async (plan: Exclude<GatewayPlan, { kind: 'error' }>, { context, settings, changes, startedAt = Date.now() }: { context: InventiveChatContext; settings: Settings; changes: ChangeSet; startedAt?: number }): Promise<GatewayAnswer> => {
  const defaultLanguage = settings.defaultLanguageCode || 'en_GB';
  const deadline = startedAt + (plan.kind === 'single' ? SINGLE_BUDGET_MS : BATCH_BUDGET_MS);
  let templates: InventiveChatTemplate[];
  try {
    templates = await withRetry(() => listTemplates(context), deadline);
  } catch (error) {
    return { status: 503, body: { error: `InventiveChat's templates could not be read: ${describeError(error)}` } };
  }

  if (plan.kind === 'single') {
    const resolved = resolveSingle(plan, templates, defaultLanguage);
    if ('error' in resolved) return { status: 422, body: { error: resolved.error } };
    const outcome = await sendGatewayTemplate({ context, settings, changes, deadline, send: { deliveryKey: plan.deliveryKey, event: plan.event, phone: plan.phone, template: resolved.template, statusCallbackUrl: plan.statusCallbackUrl, batchId: null, label: plan.label } });
    return answerForSingle(outcome);
  }

  const resolved = resolveCampaign(plan, templates, defaultLanguage);
  if ('error' in resolved) return { status: 422, body: { error: resolved.error } };
  const { accepted, toSend } = splitBatch(resolved.items, await messagesByDeliveryIds(resolved.items.map((item) => item.deliveryKey)));
  const stopped = toSend.length ? await recordConsents(context, toSend, plan.campaignId, deadline) : new Set<string>();
  const queue = toSend.filter((item) => !stopped.has(item.phone));
  let held: { reason: string; retryAt: string } | null = null;

  // A few sends at a time stays under InventiveChat's five concurrent sends per account, leaving room for the inbox.
  // What does not fit in this request, or must wait for Meta's limit, is queued for the retry job.
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const send = { deliveryKey: item.deliveryKey, event: CAMPAIGN_EVENT, phone: item.phone, template: item.template, statusCallbackUrl: plan.statusCallbackUrl, batchId: plan.batchId, label: labelFor(CAMPAIGN_EVENT) };
      const outcome = held
        ? await deferGatewayTemplate(send, held.reason, held.retryAt, 'meta', changes)
        : Date.now() > deadline
          ? await deferGatewayTemplate(send, 'Paced: sent by the next retry run.', new Date().toISOString(), 'busy', changes)
          : await sendGatewayTemplate({ context, settings, changes, deadline, send });
      if (outcome.state === 'sent') accepted.push({ recipientId: item.recipientId, messageId: outcome.messageId });
      if (outcome.state === 'deferred') {
        accepted.push({ recipientId: item.recipientId, messageId: null });
        if (outcome.code === 'meta_rate_limited') held = { reason: outcome.reason, retryAt: outcome.retryAt };
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENT_SENDS }, worker));
  return { status: 200, body: { accepted } };
};
