import { randomUUID } from 'node:crypto';

import { describeError, InventiveChatError, type InventiveChatContext, type SendResult, sendAutomationText, sendStaffText, sendTemplateToConversation, sendTemplateToPhone, type StaffMember, type TemplateMessage, withRetry } from 'src/lib/inventivechat';
import { primaryPhoneOf, waIdOf } from 'src/lib/phones';
import { type ChangeSet } from 'src/lib/realtime';
import { type ConversationRow, conversationByInventiveChatId, conversationsByPhone, createConversation, createMessage, findPersonByPhone, getPerson, messageByDeliveryId, messageById, type MessageRow, moveMessageStatus, type PersonRow, touchLastMessage, updateConversation, updateMessage } from 'src/lib/records';
import { isWindowOpen, previewOf } from 'src/lib/rules';
import { type Settings } from 'src/lib/settings';

export const TEMPLATE_ONLY = 'The customer has not written in the last 24 hours, so the first message has to be an approved template.';
export const AUTOMATION_NEEDS_TOPIC = 'Free text from an automation needs a topic that InventiveChat allows for automated replies. Give a topic, or send a template instead.';
export const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;
const BUSY_RETRY_MS = 2 * 60 * 1000;
const LATER_RETRY_MS = 15 * 60 * 1000;

export class SendRefused extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly record: MessageRow | null = null,
  ) {
    super(message);
  }
}

// InventiveChat asked to wait (a teammate is chatting, Meta's limit, or simply busy): the retry job sends it later.
export class SendDeferred extends Error {
  constructor(
    message: string,
    readonly retryAt: string,
    readonly record: MessageRow,
    readonly code: string,
  ) {
    super(message);
  }
}

export type Sender = { kind: 'member'; member: StaffMember } | { kind: 'automation'; label: string };

export type OutboundContent = { kind: 'text'; text: string } | { kind: 'template'; template: TemplateMessage };

// Kept on a message that may be sent again by the retry job, so it can rebuild exactly the same request.
export type StoredSend = { route: 'phone'; to: string; template: TemplateMessage } | { route: 'conversation'; conversationId: string; template: TemplateMessage };

const contentFields = (content: OutboundContent) =>
  content.kind === 'text' ? { messageType: 'TEXT' as const, text: content.text, templateName: null } : { messageType: 'TEMPLATE' as const, text: null, templateName: content.template.name };

const senderFields = (sender: Sender) => (sender.kind === 'member' ? { sentById: sender.member.id, sentByName: sender.member.name } : { sentByName: sender.label });

const memberOf = (sender: Sender) => (sender.kind === 'member' ? sender.member : undefined);

// A record that failed for sure is retried under a new key; one whose outcome is unknown keeps its key, so
// InventiveChat answers a repeat with the message it already sent instead of sending it twice.
export const nextIdempotencyKey = (record: Pick<MessageRow, 'id' | 'status' | 'idempotencyKey'>) => {
  const attempt = Number(/_(\d+)$/.exec(record.idempotencyKey ?? '')?.[1] ?? 0);
  if (record.idempotencyKey && record.status !== 'FAILED') return record.idempotencyKey;
  return `crm_${record.id.replace(/-/g, '')}_${attempt + 1}`;
};

export type WaitingFor = 'person' | 'meta' | 'busy';

export const waitingForOf = (error: InventiveChatError): WaitingFor => (error.code === 'human_active' ? 'person' : error.code === 'meta_rate_limited' ? 'meta' : 'busy');

// A teammate with no time limit is waited for until they hand back (conversation.updated releases the message);
// until then the only timer is the 24-hour give-up.
export const retryAtFor = (error: InventiveChatError, occurredAt: string | null, now = Date.now()) => {
  if (error.pausedUntil) return error.pausedUntil;
  if (error.retryAfterSeconds !== null) return new Date(now + error.retryAfterSeconds * 1000).toISOString();
  if (error.waitsForHandBack) return new Date((occurredAt ? Date.parse(occurredAt) : now) + GIVE_UP_AFTER_MS).toISOString();
  return new Date(now + (error.later ? LATER_RETRY_MS : BUSY_RETRY_MS)).toISOString();
};

type Attempt = { record: MessageRow; run: (idempotencyKey: string) => Promise<SendResult>; deadline: number; changes: ChangeSet; deferrable: boolean };

// Records the outcome either way, so the thread shows sent, waiting or failed without waiting for a webhook.
export const attemptSend = async ({ record, run, deadline, changes, deferrable }: Attempt) => {
  const key = nextIdempotencyKey(record);
  if (key !== record.idempotencyKey || record.status === 'FAILED' || record.retryAt) await updateMessage(record.id, { idempotencyKey: key, status: 'QUEUED', error: null, retryAt: null, waitingFor: null });
  changes.message(record.id);
  try {
    return await withRetry(() => run(key), deadline);
  } catch (error) {
    if (!(error instanceof InventiveChatError)) throw error;
    const giveUp = Date.parse(record.occurredAt ?? '') + GIVE_UP_AFTER_MS <= Date.now();
    if (deferrable && (error.later || error.retryable) && !giveUp) {
      const retryAt = retryAtFor(error, record.occurredAt);
      throw new SendDeferred(describeError(error), retryAt, await updateMessage(record.id, { error: describeError(error), retryAt, waitingFor: waitingForOf(error) }), error.code);
    }
    const unsure = error.retryable && !giveUp;
    const message = giveUp ? `Not sent within 24 hours. ${describeError(error)}` : describeError(error);
    const updated = await updateMessage(record.id, unsure ? { error: message } : { status: 'FAILED', error: message, retryAt: null, waitingFor: null });
    throw new SendRefused(message, error.retryable || error.later ? 503 : error.status === 409 ? 409 : 422, updated);
  }
};

export const finishSend = async (record: MessageRow, result: SendResult, conversation: ConversationRow | null, changes: ChangeSet) => {
  await updateMessage(record.id, { inventiveChatMessageId: result.messageId, error: null, retryAt: null, waitingFor: null, ...(conversation ? { conversationId: conversation.id, personId: record.personId ?? conversation.personId } : {}) });
  await moveMessageStatus(record.id, 'SENT');
  if (conversation) {
    await touchLastMessage(conversation.id, record.occurredAt ?? new Date().toISOString(), previewOf({ messageType: record.messageType ?? 'TEXT', text: record.text, templateName: record.templateName, mediaKind: null, mediaFilename: null }));
    changes.conversation(conversation.id);
  }
  return (await messageById(record.id)) ?? record;
};

const reuseRecord = async (recordId: string, belongsTo: (record: MessageRow) => boolean) => {
  const existing = await messageById(recordId);
  if (existing && !belongsTo(existing)) throw new SendRefused('That message id is already used by another message.', 409);
  return existing;
};

const newRecord = async (id: string, data: Record<string, unknown>) => (await createMessage({ id, ...data }, () => messageById(id))).message;

export const sendToConversation = async ({ context, conversation, content, sender, topic, recordId = randomUUID(), deadline, changes }: { context: InventiveChatContext; conversation: ConversationRow; content: OutboundContent; sender: Sender; topic?: string; recordId?: string; deadline: number; changes: ChangeSet }) => {
  if (conversation.optedOut) throw new SendRefused('This customer opted out of WhatsApp messages.', 409);
  if (content.kind === 'text' && !isWindowOpen(conversation.windowExpiresAt)) throw new SendRefused(TEMPLATE_ONLY, 409);
  if (content.kind === 'text' && sender.kind === 'automation' && !topic) throw new SendRefused(AUTOMATION_NEEDS_TOPIC, 400);
  const conversationId = conversation.inventiveChatConversationId;
  if (!conversationId) throw new SendRefused('This conversation is not linked to InventiveChat.', 409);
  const existing = await reuseRecord(recordId, (record) => record.conversationId === conversation.id);
  if (existing?.inventiveChatMessageId) return existing;
  const member = memberOf(sender);
  const stored: StoredSend | null = content.kind === 'template' && !member ? { route: 'conversation', conversationId, template: content.template } : null;
  const record =
    existing ??
    (await newRecord(recordId, {
      name: previewOf({ ...contentFields(content), mediaKind: null, mediaFilename: null }, 80),
      conversationId: conversation.id,
      personId: conversation.personId,
      direction: 'OUTBOUND',
      ...contentFields(content),
      ...senderFields(sender),
      status: 'QUEUED',
      occurredAt: new Date().toISOString(),
      recipientPhone: conversation.customerPhone,
      sendPayload: stored,
    }));
  const result = await attemptSend({
    record,
    deadline,
    changes,
    deferrable: stored !== null,
    run: (idempotencyKey) =>
      content.kind === 'template'
        ? sendTemplateToConversation(context, { conversationId, template: content.template, member, idempotencyKey, correlation: record.id })
        : member
          ? sendStaffText(context, { conversationId, text: content.text, member, idempotencyKey, correlation: record.id })
          : sendAutomationText(context, { conversationId, text: content.text, topic: topic ?? '', idempotencyKey, correlation: record.id }),
  });
  return finishSend(record, result, conversation, changes);
};

const personName = (person: Pick<PersonRow, 'name'>) => [person.name?.firstName, person.name?.lastName].filter(Boolean).join(' ').trim();

// send-to-phone answers with InventiveChat's conversation; the CRM record for it is found or created here.
export const conversationForSend = async (result: SendResult, phone: string, person: Pick<PersonRow, 'id' | 'name' | 'companyId'> | null, changes: ChangeSet) => {
  if (!result.conversationId) return null;
  const existing = await conversationByInventiveChatId(result.conversationId);
  if (existing) {
    const linked = !existing.personId && person ? await updateConversation(existing.id, { personId: person.id, ...(person.companyId && !existing.companyId ? { companyId: person.companyId } : {}) }) : existing;
    changes.conversation(linked.id);
    return linked;
  }
  const { conversation } = await createConversation({
    name: (person && personName(person)) || phone,
    customerPhone: phone,
    waId: waIdOf(phone),
    status: 'OPEN',
    personId: person?.id ?? null,
    companyId: person?.companyId ?? null,
    inventiveChatConversationId: result.conversationId,
  });
  changes.conversation(conversation.id);
  return conversation;
};

const refuseIfOptedOut = async (phone: string) => {
  if ((await conversationsByPhone(phone)).some((conversation) => conversation.optedOut)) throw new SendRefused('This customer opted out of WhatsApp messages.', 409);
};

// "Message this contact" and automations start conversations, so they always send a template, to the person's number.
export const sendTemplateToPerson = async ({ context, settings, person, template, sender, recordId = randomUUID(), deadline, changes }: { context: InventiveChatContext; settings: Settings; person: PersonRow; template: TemplateMessage; sender: Sender; recordId?: string; deadline: number; changes: ChangeSet }) => {
  const phone = primaryPhoneOf(person.phones);
  if (!phone) throw new SendRefused('This contact has no phone number with a country code, so WhatsApp cannot reach them.', 409);
  await refuseIfOptedOut(phone);
  const existing = await reuseRecord(recordId, (record) => record.personId === person.id);
  if (existing?.inventiveChatMessageId) return existing;
  const member = memberOf(sender);
  const stored: StoredSend | null = member ? null : { route: 'phone', to: phone, template };
  const record =
    existing ??
    (await newRecord(recordId, {
      name: previewOf({ messageType: 'TEMPLATE', text: null, templateName: template.name, mediaKind: null, mediaFilename: null }, 80),
      personId: person.id,
      direction: 'OUTBOUND',
      messageType: 'TEMPLATE',
      templateName: template.name,
      ...senderFields(sender),
      status: 'QUEUED',
      occurredAt: new Date().toISOString(),
      recipientPhone: phone,
      sendPayload: stored,
    }));
  const result = await attemptSend({
    record,
    deadline,
    changes,
    deferrable: stored !== null,
    run: (idempotencyKey) => sendTemplateToPhone(context, { to: phone, whatsappAccountId: settings.whatsappAccountId, template, member, idempotencyKey, correlation: record.id }),
  });
  return finishSend(record, result, await conversationForSend(result, phone, person, changes), changes);
};

export type GatewaySend = { deliveryKey: string; event: string; phone: string; template: TemplateMessage; statusCallbackUrl: string | null; batchId: string | null; label: string };

export type GatewayOutcome = { state: 'sent'; messageId: string } | { state: 'deferred'; reason: string; retryAt: string; code: string } | { state: 'failed'; error: string };

const gatewayRecord = async (send: GatewaySend) => {
  const existing = await messageByDeliveryId(send.deliveryKey);
  if (existing) return existing;
  const person = await findPersonByPhone(send.phone);
  const stored: StoredSend = { route: 'phone', to: send.phone, template: send.template };
  return (
    await createMessage(
      {
        name: previewOf({ messageType: 'TEMPLATE', text: null, templateName: send.template.name, mediaKind: null, mediaFilename: null }, 80),
        personId: person?.id ?? null,
        direction: 'OUTBOUND',
        messageType: 'TEMPLATE',
        templateName: send.template.name,
        sentByName: send.label,
        status: 'QUEUED',
        occurredAt: new Date().toISOString(),
        recipientPhone: send.phone,
        deliveryId: send.deliveryKey,
        gatewayEvent: send.event,
        batchId: send.batchId,
        statusCallbackUrl: send.statusCallbackUrl,
        sendPayload: stored,
      },
      () => messageByDeliveryId(send.deliveryKey),
    )
  ).message;
};

// Holds a notification back without asking InventiveChat, for example the rest of a batch once Meta's limit is hit.
export const deferGatewayTemplate = async (send: GatewaySend, reason: string, retryAt: string, waitingFor: WaitingFor, changes: ChangeSet): Promise<GatewayOutcome> => {
  const record = await gatewayRecord(send);
  if (record.inventiveChatMessageId) return { state: 'sent', messageId: record.inventiveChatMessageId };
  await updateMessage(record.id, { error: reason, retryAt, waitingFor, ...(record.status === 'FAILED' ? { status: 'QUEUED', idempotencyKey: nextIdempotencyKey(record) } : {}) });
  changes.message(record.id);
  return { state: 'deferred', reason, retryAt, code: 'held_back' };
};

// Deduplicated on the delivery key (a unique field): a repeated request answers with the message already sent, or
// with the wait already set, without asking InventiveChat again.
export const sendGatewayTemplate = async ({ context, settings, send, deadline, changes }: { context: InventiveChatContext; settings: Settings; send: GatewaySend; deadline: number; changes: ChangeSet }): Promise<GatewayOutcome> => {
  const record = await gatewayRecord(send);
  if (record.inventiveChatMessageId) return { state: 'sent', messageId: record.inventiveChatMessageId };
  if (record.status === 'QUEUED' && record.retryAt && Date.parse(record.retryAt) > Date.now()) return { state: 'deferred', reason: record.error ?? 'Waiting to send.', retryAt: record.retryAt, code: 'waiting' };
  try {
    const result = await attemptSend({ record, deadline, changes, deferrable: true, run: (idempotencyKey) => sendTemplateToPhone(context, { to: send.phone, whatsappAccountId: settings.whatsappAccountId, template: send.template, idempotencyKey, correlation: record.id }) });
    const person = record.personId ? await getPerson(record.personId) : null;
    await finishSend(record, result, await conversationForSend(result, send.phone, person, changes), changes);
    return { state: 'sent', messageId: result.messageId };
  } catch (error) {
    if (error instanceof SendDeferred) return { state: 'deferred', reason: error.message, retryAt: error.retryAt, code: error.code };
    if (error instanceof SendRefused) return { state: 'failed', error: error.message };
    throw error;
  }
};
