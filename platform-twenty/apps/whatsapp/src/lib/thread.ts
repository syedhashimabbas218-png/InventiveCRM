import { type ConversationHandling, type ConversationStatus, type MessageDirection, type MessageStatus, type MessageType } from 'src/constants/enums';

type FullName = { firstName: string | null; lastName: string | null } | null;

export type ConversationItem = {
  id: string;
  name: string | null;
  customerPhone: string | null;
  profileName: string | null;
  status: ConversationStatus | null;
  handling: ConversationHandling | null;
  unreadCount: number | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  windowExpiresAt: string | null;
  optedOut: boolean | null;
  customerWaiting: boolean | null;
  assigneeId: string | null;
  assignee: { id: string; name: FullName } | null;
  personId: string | null;
  person: { id: string; name: FullName } | null;
  companyId: string | null;
  company: { id: string; name: string | null } | null;
  updatedAt: string | null;
};

export type MessageItem = {
  id: string;
  conversationId: string | null;
  direction: MessageDirection | null;
  messageType: MessageType | null;
  text: string | null;
  templateName: string | null;
  mediaKind: string | null;
  mediaFilename: string | null;
  status: MessageStatus | null;
  error: string | null;
  sentByName: string | null;
  occurredAt: string | null;
  retryAt: string | null;
  updatedAt: string | null;
};

export const CONVERSATION_SELECTION =
  'id name customerPhone profileName status handling unreadCount lastMessageAt lastMessagePreview windowExpiresAt optedOut customerWaiting assigneeId assignee { id name { firstName lastName } } personId person { id name { firstName lastName } } companyId company { id name } updatedAt';
export const MESSAGE_SELECTION = 'id conversationId direction messageType text templateName mediaKind mediaFilename status error sentByName occurredAt retryAt updatedAt';

export const fullName = (name: FullName) => [name?.firstName, name?.lastName].filter(Boolean).join(' ').trim();

export const conversationTitle = (conversation: Pick<ConversationItem, 'person' | 'name' | 'profileName' | 'customerPhone'>) =>
  (conversation.person && fullName(conversation.person.name)) || conversation.name || conversation.profileName || conversation.customerPhone || 'WhatsApp customer';

export type InboxFilter = 'mine' | 'unassigned' | 'all' | 'closed';

export const matchesFilter = (row: Pick<ConversationItem, 'status' | 'assigneeId'>, filter: InboxFilter, me: string | null) => {
  if (filter === 'closed') return row.status === 'CLOSED';
  if (row.status === 'CLOSED') return false;
  if (filter === 'mine') return Boolean(me) && row.assigneeId === me;
  if (filter === 'unassigned') return !row.assigneeId;
  return true;
};

export const filterQuery = (filter: InboxFilter, me: string | null) => {
  if (filter === 'closed') return { status: { eq: 'CLOSED' } };
  if (filter === 'mine') return { status: { eq: 'OPEN' }, assigneeId: { eq: me ?? '00000000-0000-0000-0000-000000000000' } };
  if (filter === 'unassigned') return { status: { eq: 'OPEN' }, assigneeId: { is: 'NULL' } };
  return { status: { eq: 'OPEN' } };
};

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export const byNewestConversation = (left: ConversationItem, right: ConversationItem) => (right.lastMessageAt ?? '').localeCompare(left.lastMessageAt ?? '') || left.id.localeCompare(right.id);

export const byMessageTime = (left: Pick<MessageItem, 'occurredAt' | 'id'>, right: Pick<MessageItem, 'occurredAt' | 'id'>) => (left.occurredAt ?? '').localeCompare(right.occurredAt ?? '') || left.id.localeCompare(right.id);

// Unchanged rows keep their identity and an unchanged list is returned as is, so React re-renders only what changed.
export const mergeRows = <TRow extends { id: string }>(current: TRow[], incoming: TRow[], compare: (left: TRow, right: TRow) => number, keep: (row: TRow) => boolean = () => true, removedIds: string[] = []) => {
  const byId = new Map(current.map((row) => [row.id, row]));
  let changed = false;
  for (const id of removedIds)
    if (byId.has(id)) {
      byId.delete(id);
      changed = true;
    }
  for (const row of incoming) {
    const existing = byId.get(row.id);
    if (!keep(row)) {
      if (existing) {
        byId.delete(row.id);
        changed = true;
      }
      continue;
    }
    if (existing && sameJson(existing, row)) continue;
    byId.set(row.id, row);
    changed = true;
  }
  if (!changed) return current;
  return [...byId.values()].sort(compare);
};

export type TickState = 'sending' | 'waiting' | 'sent' | 'delivered' | 'read' | 'failed';

export const tickState = (message: Pick<MessageItem, 'status' | 'retryAt' | 'error'>, local: 'sending' | 'failed' | null): TickState => {
  if (message.status === 'FAILED' || local === 'failed') return 'failed';
  if (local === 'sending') return 'sending';
  if (message.status === 'READ') return 'read';
  if (message.status === 'DELIVERED') return 'delivered';
  if (message.status === 'SENT') return 'sent';
  return message.retryAt || message.error ? 'waiting' : 'sending';
};

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const dayStart = (time: number) => {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

export const relativeTime = (iso: string | null, now = Date.now()) => {
  if (!iso) return '';
  const time = Date.parse(iso);
  const age = now - time;
  if (age < MINUTE) return 'now';
  if (age < 60 * MINUTE) return `${Math.floor(age / MINUTE)} min`;
  if (time >= dayStart(now)) return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(time);
  if (time >= dayStart(now) - DAY) return 'Yesterday';
  if (time >= dayStart(now) - 6 * DAY) return new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(time);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(time);
};

export const dayLabel = (iso: string | null, now = Date.now()) => {
  if (!iso) return '';
  const time = Date.parse(iso);
  if (time >= dayStart(now)) return 'Today';
  if (time >= dayStart(now) - DAY) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(time);
};

export const clockTime = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(Date.parse(iso)) : '');

export const windowLeft = (expiresAt: string | null, now = Date.now()) => {
  if (!expiresAt) return null;
  const left = Date.parse(expiresAt) - now;
  if (left <= 0) return null;
  return left < 60 * MINUTE ? `${Math.max(1, Math.floor(left / MINUTE))} min` : `${Math.floor(left / (60 * MINUTE))} h`;
};

// 1 s doubling to 30 s, with jitter so many screens reconnecting after an outage do not arrive together.
export const reconnectDelay = (attempt: number, random = Math.random()) => Math.round(Math.min(30_000, 1000 * 2 ** attempt) * (0.75 + random * 0.5));

export type SseEvent = { event: string; data: string; id: string | null };

// Server-sent events from a streamed body; comment lines (": ping") are reported so a watchdog can see heartbeats.
export const createSseParser = (onEvent: (event: SseEvent) => void, onComment: () => void = () => {}) => {
  let buffer = '';
  let event = '';
  let data: string[] = [];
  let id: string | null = null;
  return (chunk: string) => {
    buffer += chunk;
    for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (line === '') {
        if (data.length > 0 || event) onEvent({ event: event || 'message', data: data.join('\n'), id });
        event = '';
        data = [];
      } else if (line.startsWith(':')) onComment();
      else {
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
        else if (field === 'id') id = value;
      }
    }
  };
};
