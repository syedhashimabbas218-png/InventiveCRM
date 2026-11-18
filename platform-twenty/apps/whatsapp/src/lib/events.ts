import { type MessageStatus } from 'src/constants/enums';
import { forwardStatus } from 'src/lib/callbacks';
import { type ConversationState, OUTCOME_UNKNOWN_MESSAGE, type ParsedWebhook, type WebhookMessage } from 'src/lib/inventivechat';
import { type ChangeSet } from 'src/lib/realtime';
import {
  type ConversationRow,
  conversationByInventiveChatId,
  conversationsByPhone,
  createConversation,
  createMessage,
  createPersonFor,
  findPersonByPhone,
  latestCampaignMessageTo,
  messageByIdempotencyKey,
  messageByInventiveChatId,
  type MessageRow,
  moveMessageStatus,
  noteInbound,
  recountUnread,
  releaseWaitingMessages,
  setPersonFlag,
  touchLastMessage,
  updateConversation,
  updateConversationConsent,
  updateConversationState,
  updateMessage,
} from 'src/lib/records';
import { previewOf } from 'src/lib/rules';
import { ownOrigins, type Settings } from 'src/lib/settings';

type Customer = { conversationId: string; phone: string | null; waId: string | null; profileName: string | null };

const linkPerson = async (conversation: ConversationRow, phone: string | null, profileName: string | null, mayCreate: boolean) => {
  if (conversation.personId || !phone) return conversation;
  const person = (await findPersonByPhone(phone)) ?? (mayCreate ? await createPersonFor(phone, profileName) : null);
  if (!person) return conversation;
  return updateConversation(conversation.id, { personId: person.id, ...(person.companyId && !conversation.companyId ? { companyId: person.companyId } : {}) });
};

// Finds the conversation by InventiveChat's id or creates it. Only the run that created it may create a person, so two
// webhooks for a new customer arriving together cannot add them twice.
export const ensureConversation = async (customer: Customer, settings: Settings, changes: ChangeSet, lookForPerson: boolean) => {
  const existing = await conversationByInventiveChatId(customer.conversationId);
  if (existing) {
    const missing = {
      ...(!existing.profileName && customer.profileName ? { profileName: customer.profileName, ...(!existing.personId ? { name: customer.profileName } : {}) } : {}),
      ...(!existing.waId && customer.waId ? { waId: customer.waId } : {}),
      ...(!existing.customerPhone && customer.phone ? { customerPhone: customer.phone } : {}),
    };
    const updated = Object.keys(missing).length ? await updateConversation(existing.id, missing) : existing;
    const linked = lookForPerson ? await linkPerson(updated, customer.phone, customer.profileName, false) : updated;
    if (linked !== existing) changes.conversation(existing.id);
    return linked;
  }
  const { conversation, created } = await createConversation({
    name: customer.profileName || customer.phone || 'WhatsApp customer',
    customerPhone: customer.phone,
    waId: customer.waId,
    profileName: customer.profileName,
    status: 'OPEN',
    inventiveChatConversationId: customer.conversationId,
  });
  changes.conversation(conversation.id);
  return linkPerson(conversation, customer.phone, customer.profileName, created && settings.autoCreatePeople !== false);
};

export const messageRecordData = (message: WebhookMessage, conversation: Pick<ConversationRow, 'id' | 'personId'>) => ({
  name: previewOf(message, 80),
  conversationId: conversation.id,
  personId: conversation.personId,
  direction: message.direction,
  messageType: message.messageType,
  text: message.text,
  templateName: message.templateName,
  mediaKind: message.mediaKind,
  attachmentId: message.attachmentId,
  mediaFilename: message.mediaFilename,
  status: message.status ?? (message.direction === 'OUTBOUND' ? 'SENT' : null),
  error: message.status === 'FAILED' ? message.error : null,
  sentByName: message.senderName,
  occurredAt: message.occurredAt,
  inventiveChatMessageId: message.messageId,
  idempotencyKey: message.idempotencyKey,
});

const findMessage = async (message: Pick<WebhookMessage, 'messageId' | 'idempotencyKey'>) =>
  (await messageByInventiveChatId(message.messageId)) ?? (message.idempotencyKey ? await messageByIdempotencyKey(message.idempotencyKey) : null);

const applyStatus = async (record: MessageRow, status: MessageStatus, error: string | null, origins: () => Promise<string[]>) => {
  const moved = await moveMessageStatus(record.id, status, status === 'FAILED' ? { error: error || 'WhatsApp could not deliver the message.' } : {});
  if ((moved || record.status === status) && record.deliveryId && record.statusCallbackUrl) await forwardStatus({ ...record, error: status === 'FAILED' ? error || record.error : record.error }, status, await origins());
  return moved;
};

const handleMessage = async (message: WebhookMessage, settings: Settings, changes: ChangeSet, origins: () => Promise<string[]>) => {
  const conversation = await ensureConversation(message, settings, changes, message.direction === 'INBOUND');
  const existing = await findMessage(message);
  if (existing) {
    const fill = {
      ...(!existing.inventiveChatMessageId ? { inventiveChatMessageId: message.messageId, retryAt: null } : {}),
      ...(!existing.conversationId ? { conversationId: conversation.id, personId: existing.personId ?? conversation.personId } : {}),
    };
    if (Object.keys(fill).length) await updateMessage(existing.id, fill);
    const moved = message.status ? await applyStatus({ ...existing, ...fill }, message.status, message.error, origins) : false;
    if (moved || Object.keys(fill).length) changes.message(existing.id);
    return { message: existing.id, created: false };
  }
  const { message: record, created } = await createMessage(messageRecordData(message, conversation), () => findMessage(message));
  changes.message(record.id);
  if (!created) {
    if (message.status) await applyStatus(record, message.status, message.error, origins);
    return { message: record.id, created: false };
  }
  if (message.direction === 'INBOUND') {
    await noteInbound(conversation.id, message.occurredAt);
    // History imported when a number joins counts as already read.
    if (message.importedFromHistory && (!conversation.lastReadAt || conversation.lastReadAt < message.occurredAt)) await updateConversation(conversation.id, { lastReadAt: message.occurredAt });
  }
  await touchLastMessage(conversation.id, message.occurredAt, previewOf(message));
  if (message.direction === 'INBOUND') await recountUnread(conversation.id);
  changes.conversation(conversation.id);
  return { message: record.id, created: true };
};

// InventiveChat's state drives "AI replying", "A person is replying" and "Automation awaiting approval"; a hand-off
// request stays shown until a state replaces it. A person handing back releases notifications held for them.
const applyConversationState = async (state: ConversationState, occurredAt: string, settings: Settings, changes: ChangeSet) => {
  const conversation = await ensureConversation(state, settings, changes, false);
  const handling = state.handling ?? (conversation.handling === 'HANDOFF_REQUESTED' && !state.closed ? 'HANDOFF_REQUESTED' : null);
  const update = {
    ...(handling !== conversation.handling ? { handling } : {}),
    ...(state.customerWaiting !== null && state.customerWaiting !== Boolean(conversation.customerWaiting) ? { customerWaiting: state.customerWaiting } : {}),
    ...(state.aiPausedUntil !== conversation.aiPausedUntil ? { aiPausedUntil: state.aiPausedUntil } : {}),
    ...(state.closed && conversation.status !== 'CLOSED' ? { status: 'CLOSED' } : {}),
  };
  if (!(await updateConversationState(conversation.id, occurredAt, update))) return { ignored: 'older than the state shown', conversation: conversation.id };
  if (Object.keys(update).length) changes.conversation(conversation.id);
  if (!state.personActive) for (const id of await releaseWaitingMessages(conversation)) changes.message(id);
  return { conversation: conversation.id };
};

const conversationsFor = async (conversationId: string | null, phone: string | null) => {
  const found = new Map<string, ConversationRow>();
  if (conversationId) {
    const byId = await conversationByInventiveChatId(conversationId);
    if (byId) found.set(byId.id, byId);
  }
  if (phone) for (const conversation of await conversationsByPhone(phone)) found.set(conversation.id, conversation);
  return [...found.values()];
};

const peopleFor = async (conversations: ConversationRow[], phone: string | null) => {
  const ids = new Set(conversations.flatMap((conversation) => (conversation.personId ? [conversation.personId] : [])));
  if (phone) {
    const person = await findPersonByPhone(phone);
    if (person) ids.add(person.id);
  }
  return [...ids];
};

// A STOP and a later START (or the reverse) must not swap places when one is retried late. Without a conversation
// there is nothing to compare with, so the report applies.
const applyConsent = async (conversations: ConversationRow[], occurredAt: string, changesFor: (conversation: ConversationRow) => Record<string, unknown>, changes: ChangeSet) => {
  let applied = conversations.length === 0;
  for (const conversation of conversations)
    if (await updateConversationConsent(conversation.id, occurredAt, changesFor(conversation))) {
      applied = true;
      changes.conversation(conversation.id);
    }
  return applied;
};

export const handleWebhook = async ({ event, occurredAt }: ParsedWebhook, settings: Settings, changes: ChangeSet) => {
  let cachedOrigins: Promise<string[]> | null = null;
  const origins = () => (cachedOrigins ??= ownOrigins());
  switch (event.kind) {
    case 'message':
      return handleMessage(event.message, settings, changes, origins);
    // Failed with the reason shown, so it is never retried on its own and a person can choose to send it again.
    case 'outcome_unknown': {
      const record = await messageByIdempotencyKey(event.idempotencyKey);
      if (!record) return { ignored: 'unknown message' };
      if (record.inventiveChatMessageId) return { ignored: 'already sent', message: record.id };
      const moved = await moveMessageStatus(record.id, 'FAILED', { error: OUTCOME_UNKNOWN_MESSAGE, retryAt: null, waitingFor: null });
      if (moved && record.deliveryId && record.statusCallbackUrl) await forwardStatus({ ...record, error: OUTCOME_UNKNOWN_MESSAGE }, 'FAILED', await origins());
      changes.message(record.id);
      return { message: record.id };
    }
    case 'conversation_state':
      return applyConversationState(event.state, occurredAt, settings, changes);
    case 'handling': {
      const conversation = await conversationByInventiveChatId(event.conversationId);
      if (!conversation) return { ignored: 'unknown conversation' };
      if (!(await updateConversationState(conversation.id, occurredAt, conversation.handling !== event.handling ? { handling: event.handling } : {}))) return { ignored: 'older than the state shown', conversation: conversation.id };
      changes.conversation(conversation.id);
      if (event.handling !== 'PERSON') for (const id of await releaseWaitingMessages(conversation)) changes.message(id);
      return { conversation: conversation.id };
    }
    case 'opted_out': {
      const conversations = await conversationsFor(event.conversationId, event.phone);
      if (!(await applyConsent(conversations, occurredAt, (conversation) => (conversation.optedOut ? {} : { optedOut: true }), changes))) return { ignored: 'older than the consent shown' };
      for (const personId of await peopleFor(conversations, event.phone)) {
        await setPersonFlag(personId, 'whatsappOptIn', false);
        await setPersonFlag(personId, 'whatsappMarketingConsent', false);
      }
      // Campaign Studio keeps its own do-not-contact list, which only learns of an opt-out through this callback.
      const campaignMessage = await latestCampaignMessageTo(conversations.map((conversation) => conversation.id));
      if (campaignMessage) await forwardStatus(campaignMessage, 'OPTED_OUT', await origins());
      return { conversations: conversations.length };
    }
    case 'consent': {
      const conversations = await conversationsFor(null, event.phone);
      const optedOut = event.optedOut;
      if (!(await applyConsent(conversations, occurredAt, (conversation) => (optedOut !== null && Boolean(conversation.optedOut) !== optedOut ? { optedOut } : {}), changes))) return { ignored: 'older than the consent shown' };
      for (const personId of await peopleFor(conversations, event.phone)) await setPersonFlag(personId, 'whatsappMarketingConsent', event.consent && event.optedOut !== true);
      return { conversations: conversations.length };
    }
    case 'ignored':
      return { ignored: event.eventType };
  }
};
