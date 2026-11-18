import { type ConversationHandling, type ConversationStatus, type MessageDirection, type MessageStatus, type MessageType } from 'src/constants/enums';
import { gql, nodes } from 'src/lib/api';
import { hasPhone, likeLiteral, type PersonPhones, searchTail } from 'src/lib/phones';
import { statusesThatCanMoveTo, windowExpiresAt } from 'src/lib/rules';

export type ConversationRow = {
  id: string;
  name: string | null;
  customerPhone: string | null;
  waId: string | null;
  profileName: string | null;
  status: ConversationStatus | null;
  handling: ConversationHandling | null;
  personId: string | null;
  companyId: string | null;
  assigneeId: string | null;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  lastReadAt: string | null;
  unreadCount: number | null;
  windowExpiresAt: string | null;
  optedOut: boolean | null;
  customerWaiting: boolean | null;
  aiPausedUntil: string | null;
  inventiveChatConversationId: string | null;
};

export type MessageRow = {
  id: string;
  conversationId: string | null;
  personId: string | null;
  direction: MessageDirection | null;
  messageType: MessageType | null;
  text: string | null;
  templateName: string | null;
  mediaKind: string | null;
  attachmentId: string | null;
  mediaFilename: string | null;
  status: MessageStatus | null;
  error: string | null;
  sentById: string | null;
  sentByName: string | null;
  occurredAt: string | null;
  inventiveChatMessageId: string | null;
  idempotencyKey: string | null;
  deliveryId: string | null;
  gatewayEvent: string | null;
  batchId: string | null;
  statusCallbackUrl: string | null;
  retryAt: string | null;
  sendPayload: unknown;
  waitingFor: string | null;
  recipientPhone: string | null;
};

export type PersonRow = { id: string; name: { firstName: string | null; lastName: string | null } | null; phones: PersonPhones; companyId: string | null };

export const CONVERSATION_FIELDS =
  'id name customerPhone waId profileName status handling personId companyId assigneeId lastMessageAt lastInboundAt lastReadAt unreadCount windowExpiresAt optedOut customerWaiting aiPausedUntil inventiveChatConversationId';
export const MESSAGE_FIELDS =
  'id conversationId personId direction messageType text templateName mediaKind attachmentId mediaFilename status error sentById sentByName occurredAt inventiveChatMessageId idempotencyKey deliveryId gatewayEvent batchId statusCallbackUrl retryAt sendPayload waitingFor recipientPhone';
const PERSON_FIELDS = 'id name { firstName lastName } phones { primaryPhoneNumber primaryPhoneCallingCode additionalPhones { number callingCode } } companyId';

export const isUniqueViolation = (error: unknown) => error instanceof Error && /duplicate|unique constraint/i.test(error.message);

const declarationsOf = (types: Record<string, string>) => {
  const entries = Object.entries(types);
  return entries.length ? `(${entries.map(([name, type]) => `$${name}: ${type}`).join(', ')})` : '';
};

const conversationsWhere = async (filter: string, variables: Record<string, unknown>, types: Record<string, string>, first = 1) =>
  nodes(
    (await gql<{ whatsappConversations: { edges: { node: ConversationRow }[] } }>(`query${declarationsOf(types)} { whatsappConversations(filter: ${filter}, orderBy: [{ createdAt: AscNullsLast }], first: ${first}) { edges { node { ${CONVERSATION_FIELDS} } } } }`, variables))
      .whatsappConversations,
  );

export const getConversation = async (id: string) => (await conversationsWhere('{ id: { eq: $id } }', { id }, { id: 'UUID' }))[0] ?? null;

export const conversationByInventiveChatId = async (inventiveChatConversationId: string) =>
  (await conversationsWhere('{ inventiveChatConversationId: { eq: $key } }', { key: inventiveChatConversationId }, { key: 'String' }))[0] ?? null;

export const conversationsByPhone = (phone: string) => conversationsWhere('{ customerPhone: { eq: $phone } }', { phone }, { phone: 'String' }, 20);

// Two webhooks for a new customer can arrive together; the unique InventiveChat id lets only one create the record.
export const createConversation = async (data: Partial<ConversationRow> & { inventiveChatConversationId: string }) => {
  try {
    const created = await gql<{ createWhatsappConversation: ConversationRow }>(`mutation($data: WhatsappConversationCreateInput!) { createWhatsappConversation(data: $data) { ${CONVERSATION_FIELDS} } }`, { data });
    return { conversation: created.createWhatsappConversation, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await conversationByInventiveChatId(data.inventiveChatConversationId);
    if (!existing) throw error;
    return { conversation: existing, created: false };
  }
};

export const updateConversation = (id: string, data: Record<string, unknown>) =>
  gql<{ updateWhatsappConversation: ConversationRow }>(`mutation($id: UUID!, $data: WhatsappConversationUpdateInput!) { updateWhatsappConversation(id: $id, data: $data) { ${CONVERSATION_FIELDS} } }`, { id, data }).then((result) => result.updateWhatsappConversation);

// Applied only if InventiveChat reported it no earlier than the state already shown, so a late retry of an older event
// cannot undo a newer one. Equal times apply, since InventiveChat's clock is in milliseconds, not commit order.
export const updateConversationState = async (id: string, occurredAt: string, data: Record<string, unknown>) =>
  (
    await gql<{ updateWhatsappConversations: { id: string }[] }>(
      `mutation($id: UUID, $at: DateTime, $data: WhatsappConversationUpdateInput!) { updateWhatsappConversations(filter: { id: { eq: $id }, or: [{ stateEventAt: { is: NULL } }, { stateEventAt: { lte: $at } }] }, data: $data) { id } }`,
      { id, at: occurredAt, data: { ...data, stateEventAt: occurredAt } },
    )
  ).updateWhatsappConversations.length > 0;

// Only moves forward, so an older message arriving late never replaces the newest preview.
export const touchLastMessage = (id: string, at: string, preview: string) =>
  gql(`mutation($id: UUID, $at: DateTime, $data: WhatsappConversationUpdateInput!) { updateWhatsappConversations(filter: { id: { eq: $id }, or: [{ lastMessageAt: { is: NULL } }, { lastMessageAt: { lte: $at } }] }, data: $data) { id } }`, {
    id,
    at,
    data: { lastMessageAt: at, lastMessagePreview: preview },
  });

// A customer writing opens the 24-hour window again and brings a closed conversation back to the inbox.
export const noteInbound = (id: string, at: string) =>
  gql(`mutation($id: UUID, $at: DateTime, $data: WhatsappConversationUpdateInput!) { updateWhatsappConversations(filter: { id: { eq: $id }, or: [{ lastInboundAt: { is: NULL } }, { lastInboundAt: { lt: $at } }] }, data: $data) { id } }`, {
    id,
    at,
    data: { lastInboundAt: at, windowExpiresAt: windowExpiresAt(at), status: 'OPEN' },
  });

const NEVER_READ = '1970-01-01T00:00:00.000Z';

// Counted from the messages rather than incremented, so replays and concurrent webhooks cannot inflate it.
export const recountUnread = async (id: string) => {
  const conversation = await getConversation(id);
  if (!conversation) return 0;
  const { whatsappMessages } = await gql<{ whatsappMessages: { totalCount: number } }>(
    `query($id: UUID, $since: DateTime) { whatsappMessages(filter: { conversationId: { eq: $id }, direction: { eq: INBOUND }, occurredAt: { gt: $since } }) { totalCount } }`,
    { id, since: conversation.lastReadAt ?? NEVER_READ },
  );
  if (whatsappMessages.totalCount !== (conversation.unreadCount ?? 0)) await updateConversation(id, { unreadCount: whatsappMessages.totalCount });
  return whatsappMessages.totalCount;
};

const messagesWhere = async (filter: string, variables: Record<string, unknown>, types: Record<string, string>, first = 1) =>
  nodes((await gql<{ whatsappMessages: { edges: { node: MessageRow }[] } }>(`query${declarationsOf(types)} { whatsappMessages(filter: ${filter}, orderBy: [{ createdAt: AscNullsLast }], first: ${first}) { edges { node { ${MESSAGE_FIELDS} } } } }`, variables)).whatsappMessages);

export const messageById = async (id: string) => (await messagesWhere('{ id: { eq: $id } }', { id }, { id: 'UUID' }))[0] ?? null;

export const messageByInventiveChatId = async (messageId: string) => (await messagesWhere('{ inventiveChatMessageId: { eq: $key } }', { key: messageId }, { key: 'String' }))[0] ?? null;

export const messageByIdempotencyKey = async (key: string) => (await messagesWhere('{ idempotencyKey: { eq: $key } }', { key }, { key: 'String' }))[0] ?? null;

export const messageByDeliveryId = async (deliveryId: string) => (await messagesWhere('{ deliveryId: { eq: $key } }', { key: deliveryId }, { key: 'String' }))[0] ?? null;

export const messagesByDeliveryIds = async (deliveryIds: string[]) =>
  deliveryIds.length === 0 ? [] : messagesWhere('{ deliveryId: { in: $keys } }', { keys: deliveryIds }, { keys: '[String]' }, Math.min(200, deliveryIds.length));

// The latest campaign message to a phone that can still report an opt-out back to Campaign Studio.
export const latestCampaignMessageTo = async (conversationIds: string[]) =>
  conversationIds.length === 0
    ? null
    : (nodes(
        (
          await gql<{ whatsappMessages: { edges: { node: MessageRow }[] } }>(
            `query($ids: [UUID]) { whatsappMessages(filter: { conversationId: { in: $ids }, gatewayEvent: { eq: "campaign.message" }, statusCallbackUrl: { is: NOT_NULL } }, orderBy: [{ occurredAt: DescNullsLast }], first: 1) { edges { node { ${MESSAGE_FIELDS} } } } }`,
            { ids: conversationIds },
          )
        ).whatsappMessages,
      )[0] ?? null);

export const createMessage = async (data: Record<string, unknown>, findExisting: () => Promise<MessageRow | null>) => {
  try {
    const created = await gql<{ createWhatsappMessage: MessageRow }>(`mutation($data: WhatsappMessageCreateInput!) { createWhatsappMessage(data: $data) { ${MESSAGE_FIELDS} } }`, { data });
    return { message: created.createWhatsappMessage, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await findExisting();
    if (!existing) throw error;
    return { message: existing, created: false };
  }
};

export const updateMessage = (id: string, data: Record<string, unknown>) =>
  gql<{ updateWhatsappMessage: MessageRow }>(`mutation($id: UUID!, $data: WhatsappMessageUpdateInput!) { updateWhatsappMessage(id: $id, data: $data) { ${MESSAGE_FIELDS} } }`, { id, data }).then((result) => result.updateWhatsappMessage);

// Conditional on the current status, so two webhooks racing can never move a message backwards.
export const moveMessageStatus = async (id: string, to: MessageStatus, extra: Record<string, unknown> = {}) => {
  const from = statusesThatCanMoveTo(to);
  const result = await gql<{ updateWhatsappMessages: { id: string }[] }>(
    `mutation($id: UUID, $data: WhatsappMessageUpdateInput!) { updateWhatsappMessages(filter: { id: { eq: $id }, or: [{ status: { is: NULL } }, { status: { in: [${from.join(', ')}] } }] }, data: $data) { id } }`,
    { id, data: { ...extra, status: to } },
  );
  return result.updateWhatsappMessages.length > 0;
};

// Messages InventiveChat asked us to send again later, oldest wait first.
export const messagesDueForRetry = async (now: string, first: number) =>
  nodes(
    (
      await gql<{ whatsappMessages: { edges: { node: MessageRow }[] } }>(
        `query($now: DateTime) { whatsappMessages(filter: { status: { eq: QUEUED }, retryAt: { lte: $now }, inventiveChatMessageId: { is: NULL } }, orderBy: [{ retryAt: AscNullsLast }], first: ${first}) { edges { node { ${MESSAGE_FIELDS} } } } }`,
        { now },
      )
    ).whatsappMessages,
  );

// Notifications held back while a teammate was chatting go to the retry job as soon as they hand the customer back.
export const releaseWaitingMessages = async (conversation: Pick<ConversationRow, 'id' | 'customerPhone'>) => {
  const phone = conversation.customerPhone;
  const match = phone ? '{ or: [{ conversationId: { eq: $id } }, { recipientPhone: { eq: $phone } }] }' : '{ conversationId: { eq: $id } }';
  const result = await gql<{ updateWhatsappMessages: { id: string }[] }>(
    `mutation($id: UUID, $now: DateTime${phone ? ', $phone: String' : ''}) { updateWhatsappMessages(filter: { and: [{ status: { eq: QUEUED } }, { waitingFor: { eq: "person" } }, { inventiveChatMessageId: { is: NULL } }, ${match}] }, data: { retryAt: $now }) { id } }`,
    { id: conversation.id, now: new Date().toISOString(), ...(phone ? { phone } : {}) },
  );
  return result.updateWhatsappMessages.map((row) => row.id);
};

export const recentSendCount = async (memberId: string) =>
  (
    await gql<{ whatsappMessages: { totalCount: number } }>(`query($me: UUID, $since: DateTime) { whatsappMessages(filter: { sentById: { eq: $me }, createdAt: { gt: $since } }) { totalCount } }`, {
      me: memberId,
      since: new Date(Date.now() - 60_000).toISOString(),
    })
  ).whatsappMessages.totalCount;

export const getPerson = async (id: string) =>
  nodes((await gql<{ people: { edges: { node: PersonRow }[] } }>(`query($id: UUID) { people(filter: { id: { eq: $id } }, first: 1) { edges { node { ${PERSON_FIELDS} } } } }`, { id })).people)[0] ?? null;

// The database narrows by the last digits; the exact international comparison, which Twenty cannot do, runs here.
export const findPersonByPhone = async (e164: string) => {
  const tail = searchTail(e164);
  const candidates = nodes(
    (
      await gql<{ people: { edges: { node: PersonRow }[] } }>(
        `query($primary: String, $additional: String) { people(filter: { or: [{ phones: { primaryPhoneNumber: { ilike: $primary } } }, { phones: { additionalPhones: { like: $additional } } }] }, orderBy: [{ createdAt: AscNullsLast }], first: 50) { edges { node { ${PERSON_FIELDS} } } } }`,
        { primary: likeLiteral(tail, 'suffix'), additional: likeLiteral(tail, 'contains') },
      )
    ).people,
  );
  return candidates.find((person) => hasPhone(person.phones, e164)) ?? null;
};

export const nameFromProfile = (profileName: string | null, phone: string) => {
  const words = (profileName ?? '').trim().replace(/\s+/g, ' ').slice(0, 100).split(' ').filter(Boolean);
  if (words.length === 0) return { firstName: phone, lastName: '' };
  return { firstName: words[0] as string, lastName: words.slice(1).join(' ') };
};

export const createPersonFor = async (e164: string, profileName: string | null) => {
  const name = nameFromProfile(profileName, e164);
  const create = (data: Record<string, unknown>) => gql<{ createPerson: PersonRow }>(`mutation($data: PersonCreateInput!) { createPerson(data: $data) { ${PERSON_FIELDS} } }`, { data }).then((result) => result.createPerson);
  try {
    return await create({ name, phones: { primaryPhoneNumber: e164 } });
  } catch (error) {
    // Twenty validates numbers more strictly than WhatsApp; the conversation still keeps the number.
    console.error(`whatsapp: person created without a phone: ${(error as Error).message}`);
    return create({ name });
  }
};

// Consent fields belong to other apps (Quotes & Invoices, Campaign Studio) and may not be installed.
export const setPersonFlag = async (personId: string, field: 'whatsappOptIn' | 'whatsappMarketingConsent', value: boolean) => {
  try {
    await gql(`mutation($id: UUID!, $data: PersonUpdateInput!) { updatePerson(id: $id, data: $data) { id } }`, { id: personId, data: { [field]: value } });
    return true;
  } catch (error) {
    if (new RegExp(field).test((error as Error).message)) return false;
    throw error;
  }
};
