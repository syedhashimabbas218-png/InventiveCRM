import { RestApiClient, RestApiClientError } from 'twenty-client-sdk/rest';

import {
  byMessageTime,
  byNewestConversation,
  CONVERSATION_SELECTION,
  type ConversationItem,
  createSseParser,
  filterQuery,
  type InboxFilter,
  matchesFilter,
  MESSAGE_SELECTION,
  type MessageItem,
  mergeRows,
  reconnectDelay,
} from 'src/lib/thread';

// The only module that talks to the network. Reads go straight to GraphQL with the viewer's own token (fast, and
// Twenty's permissions apply); actions go to the app route; live changes come from the realtime hub. A different push
// source only has to replace openLiveConnection.

const client = new RestApiClient();

export class ActionError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const callWhatsApp = async <TData,>(body: Record<string, unknown>): Promise<TData> => {
  try {
    return await client.post<TData>('/s/whatsapp/api', body);
  } catch (error) {
    const details = error instanceof RestApiClientError && error.body && typeof error.body === 'object' ? (error.body as Record<string, unknown>) : {};
    throw new ActionError(typeof details.error === 'string' ? details.error : (error as Error).message, error instanceof RestApiClientError ? (error.status ?? null) : null, details);
  }
};

export const graphql = async <TData,>(query: string, variables: Record<string, unknown> = {}): Promise<TData> => {
  const result = await client.post<{ data?: TData; errors?: { message: string }[] }>('/graphql', { query, variables });
  if (result.errors?.length) throw new Error(result.errors.map((error) => error.message).join('; '));
  if (!result.data) throw new Error('Twenty returned no data.');
  return result.data;
};

type Edges<TNode> = { edges: { node: TNode }[] };
const nodesOf = <TNode,>(connection: Edges<TNode> | undefined) => connection?.edges.map((edge) => edge.node) ?? [];

export const fetchConversations = async (filter: Record<string, unknown>, first = 50) =>
  nodesOf((await graphql<{ whatsappConversations: Edges<ConversationItem> }>(`query($filter: WhatsappConversationFilterInput) { whatsappConversations(filter: $filter, orderBy: [{ lastMessageAt: DescNullsLast }], first: ${first}) { edges { node { ${CONVERSATION_SELECTION} } } } }`, { filter })).whatsappConversations);

const fetchConversationsByIds = (ids: string[]) => (ids.length ? fetchConversations({ id: { in: ids } }, ids.length) : Promise.resolve([]));

const PAGE = 40;

const fetchMessages = async (filter: Record<string, unknown>, first = PAGE) =>
  nodesOf((await graphql<{ whatsappMessages: Edges<MessageItem> }>(`query($filter: WhatsappMessageFilterInput) { whatsappMessages(filter: $filter, orderBy: [{ occurredAt: DescNullsLast }, { id: AscNullsLast }], first: ${first}) { edges { node { ${MESSAGE_SELECTION} } } } }`, { filter })).whatsappMessages);

export const fetchMe = async (userId: string | null) => {
  if (!userId) return null;
  const members = nodesOf((await graphql<{ workspaceMembers: Edges<{ id: string }> }>(`query($userId: UUID) { workspaceMembers(filter: { userId: { eq: $userId } }, first: 1) { edges { node { id } } } }`, { userId })).workspaceMembers);
  return members[0]?.id ?? null;
};

export type ConnectionState = { connected: boolean; problem: string | null; phoneNumber: string | null; displayName: string | null };

export const fetchConnectionState = async (): Promise<ConnectionState> => {
  const rows = nodesOf((await graphql<{ whatsappSettingsRecords: Edges<{ tenantId: string | null; webhookProblem: string | null; phoneNumber: string | null; displayName: string | null }> }>(`{ whatsappSettingsRecords(orderBy: [{ createdAt: AscNullsLast }], first: 1) { edges { node { tenantId webhookProblem phoneNumber displayName } } } }`)).whatsappSettingsRecords);
  const row = rows[0];
  return { connected: Boolean(row?.tenantId), problem: row?.webhookProblem || null, phoneNumber: row?.phoneNumber ?? null, displayName: row?.displayName ?? null };
};

const RESYNC_SPREAD_MS = 5_000;

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'off';
export type ChangeKind = 'conversation' | 'message';
type LiveListener = { onChange: (kind: ChangeKind, ids: string[]) => void; onResync: () => void };
type RealtimeToken = { url: string; token: string; expiresAt: string };

const HEARTBEAT_TIMEOUT_MS = 45_000;
const BATCH_MS = 50;

// One connection per mounted screen, shared by its list and thread.
export const openLiveConnection = (onStatus: (status: LiveStatus) => void = () => {}) => {
  const listeners = new Set<LiveListener>();
  const pending = new Map<ChangeKind, Set<string>>();
  let closed = false;
  let generation = 0;
  let watchHeartbeat = true;
  let attempt = 0;
  let connectedOnce = false;
  let lastEventId: string | null = null;
  let token: RealtimeToken | null = null;
  let stop: () => void = () => {};
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let batchTimer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    batchTimer = undefined;
    for (const [kind, ids] of pending) for (const listener of listeners) listener.onChange(kind, [...ids]);
    pending.clear();
  };

  const onChange = (data: string) => {
    try {
      const change = JSON.parse(data) as { kind?: unknown; ids?: unknown };
      if ((change.kind !== 'conversation' && change.kind !== 'message') || !Array.isArray(change.ids)) return;
      const ids = pending.get(change.kind) ?? new Set<string>();
      for (const id of change.ids) if (typeof id === 'string') ids.add(id);
      pending.set(change.kind, ids);
      batchTimer ??= setTimeout(flush, BATCH_MS);
    } catch {
      // A malformed event is skipped; the next resync covers anything it carried.
    }
  };

  // After a restart of the realtime service every open screen resyncs at once; spreading them over a few seconds
  // keeps that from arriving at the server as one burst.
  let resyncTimer: ReturnType<typeof setTimeout> | undefined;
  const resyncAll = () => {
    clearTimeout(resyncTimer);
    resyncTimer = setTimeout(() => listeners.forEach((listener) => listener.onResync()), Math.random() * RESYNC_SPREAD_MS);
  };

  // Bumping the generation makes the connection being torn down ignore its own failure, so only one retry is queued.
  const scheduleReconnect = () => {
    generation += 1;
    stop();
    clearTimeout(watchdog);
    clearTimeout(retryTimer);
    if (closed) return;
    onStatus('reconnecting');
    retryTimer = setTimeout(connect, reconnectDelay(attempt));
    attempt += 1;
  };

  const resetWatchdog = () => {
    clearTimeout(watchdog);
    if (watchHeartbeat) watchdog = setTimeout(scheduleReconnect, HEARTBEAT_TIMEOUT_MS);
  };

  const opened = () => {
    attempt = 0;
    onStatus('live');
    resetWatchdog();
    if (connectedOnce) resyncAll();
    connectedOnce = true;
  };

  const dispatch = (event: string, data: string, id: string | null) => {
    resetWatchdog();
    if (id) lastEventId = id;
    if (event === 'change') onChange(data);
    else if (event === 'resync') resyncAll();
    else if (event === 'expired') {
      token = null;
      attempt = 0;
      scheduleReconnect();
    }
  };

  const streamUrl = (current: RealtimeToken) => `${current.url}?token=${encodeURIComponent(current.token)}&topics=whatsapp${lastEventId ? `&lastEventId=${encodeURIComponent(lastEventId)}` : ''}`;

  // A streamed fetch sees the hub's ": ping" comments, which EventSource hides, so the heartbeat watchdog works.
  const viaFetch = async (current: RealtimeToken) => {
    watchHeartbeat = true;
    const controller = new AbortController();
    stop = () => controller.abort();
    const response = await fetch(streamUrl(current), { headers: { Accept: 'text/event-stream' }, cache: 'no-store', signal: controller.signal });
    if (response.status === 401 || response.status === 403) token = null;
    if (!response.ok || !response.body) throw new Error(`the realtime hub answered ${response.status}`);
    opened();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parse = createSseParser((event) => dispatch(event.event, event.data, event.id), resetWatchdog);
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) parse(decoder.decode(chunk.value, { stream: true }));
    throw new Error('the realtime stream ended');
  };

  const viaEventSource = (current: RealtimeToken) =>
    new Promise<never>((_resolve, reject) => {
      watchHeartbeat = false;
      const source = new EventSource(streamUrl(current));
      stop = () => source.close();
      source.onopen = opened;
      source.onerror = () => reject(new Error('the realtime connection dropped'));
      for (const name of ['change', 'resync', 'expired']) source.addEventListener(name, (event) => dispatch(name, (event as MessageEvent<string>).data, (event as MessageEvent<string>).lastEventId || null));
    });

  const connect = async () => {
    if (closed) return;
    const mine = ++generation;
    onStatus(connectedOnce ? 'reconnecting' : 'connecting');
    try {
      if (!token || Date.parse(token.expiresAt) < Date.now() + 60_000) {
        const minted = await callWhatsApp<{ url: string | null; token?: string; expiresAt?: string }>({ action: 'realtimeToken' });
        if (!minted.url || !minted.token || !minted.expiresAt) {
          onStatus('off');
          return;
        }
        token = { url: minted.url, token: minted.token, expiresAt: minted.expiresAt };
      }
      if (closed || mine !== generation) return;
      const canStream = typeof ReadableStream !== 'undefined' && typeof TextDecoder !== 'undefined';
      await (canStream || typeof EventSource === 'undefined' ? viaFetch(token) : viaEventSource(token));
    } catch {
      if (!closed && mine === generation) scheduleReconnect();
    }
  };

  connect();

  return {
    subscribe: (listener: LiveListener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close: () => {
      closed = true;
      stop();
      clearTimeout(watchdog);
      clearTimeout(retryTimer);
      clearTimeout(batchTimer);
      clearTimeout(resyncTimer);
      listeners.clear();
    },
  };
};

export type LiveConnection = ReturnType<typeof openLiveConnection>;

export type ListQuery = { filter: Record<string, unknown>; matches: (row: ConversationItem) => boolean };

export const inboxQuery = (filter: InboxFilter, me: string | null): ListQuery => ({ filter: filterQuery(filter, me), matches: (row) => matchesFilter(row, filter, me) });

// Keeps one filtered conversation list current: changed ids are re-read and merged, a resync reloads the list.
export const subscribeToConversationList = (live: LiveConnection | null, initial: ListQuery, { onRows, onError }: { onRows: (rows: ConversationItem[]) => void; onError: (message: string) => void }) => {
  let rows: ConversationItem[] = [];
  let generation = 0;
  let query = initial;
  let closed = false;
  // A full load always reports, so a screen waiting for its first rows (even none) stops loading.
  const publish = (next: ConversationItem[], always = false) => {
    if ((next === rows && !always) || closed) return;
    rows = next;
    onRows(rows);
  };
  const load = async () => {
    const mine = ++generation;
    try {
      const fresh = await fetchConversations(query.filter);
      const gone = rows.filter((row) => !fresh.some((item) => item.id === row.id)).map((row) => row.id);
      if (mine === generation) publish(mergeRows(rows, fresh, byNewestConversation, () => true, gone), true);
    } catch (error) {
      if (mine === generation && !closed) onError((error as Error).message);
    }
  };
  const apply = async (ids: string[]) => {
    try {
      const fresh = await fetchConversationsByIds(ids);
      const gone = ids.filter((id) => !fresh.some((row) => row.id === id));
      publish(mergeRows(rows, fresh, byNewestConversation, query.matches, gone));
    } catch (error) {
      if (!closed) onError((error as Error).message);
    }
  };
  const unsubscribe = live?.subscribe({ onChange: (kind, ids) => kind === 'conversation' && apply(ids), onResync: load }) ?? (() => {});
  load();
  return {
    setQuery: (next: ListQuery) => {
      query = next;
      rows = [];
      load();
    },
    refresh: load,
    apply,
    close: () => {
      closed = true;
      unsubscribe();
    },
  };
};

export type ThreadState = { conversation: ConversationItem | null; messages: MessageItem[]; hasMore: boolean; loaded: boolean };

// Keeps one conversation and its messages current. Local (optimistic) messages share the server's id, so the saved
// row simply replaces them when it arrives.
export const subscribeToConversation = (live: LiveConnection | null, conversationId: string, { onState, onError }: { onState: (state: ThreadState) => void; onError: (message: string) => void }) => {
  let state: ThreadState = { conversation: null, messages: [], hasMore: false, loaded: false };
  let closed = false;
  const publish = (next: Partial<ThreadState>) => {
    if (closed) return;
    state = { ...state, ...next };
    onState(state);
  };
  const belongs = (row: MessageItem) => row.conversationId === conversationId;
  const loadConversation = async () => {
    const [conversation] = await fetchConversationsByIds([conversationId]);
    if (JSON.stringify(conversation ?? null) !== JSON.stringify(state.conversation)) publish({ conversation: conversation ?? null });
  };
  const load = async () => {
    try {
      const [, latest] = await Promise.all([loadConversation(), fetchMessages({ conversationId: { eq: conversationId } })]);
      const merged = mergeRows(state.messages, latest, byMessageTime, belongs);
      publish({ messages: merged, hasMore: state.loaded ? state.hasMore : latest.length === PAGE, loaded: true });
    } catch (error) {
      onError((error as Error).message);
    }
  };
  const applyMessages = async (ids: string[]) => {
    try {
      const fresh = await fetchMessages({ id: { in: ids } }, ids.length);
      const merged = mergeRows(state.messages, fresh.filter(belongs), byMessageTime);
      if (merged !== state.messages) publish({ messages: merged });
    } catch (error) {
      onError((error as Error).message);
    }
  };
  const unsubscribe =
    live?.subscribe({
      onChange: (kind, ids) => {
        if (kind === 'message') applyMessages(ids);
        else if (ids.includes(conversationId)) loadConversation().catch((error: Error) => onError(error.message));
      },
      onResync: load,
    }) ?? (() => {});
  load();
  return {
    refresh: load,
    applyMessages,
    upsertLocal: (row: MessageItem) => publish({ messages: mergeRows(state.messages, [row], byMessageTime) }),
    loadEarlier: async () => {
      const earliest = state.messages[0];
      if (!earliest?.occurredAt) return;
      const older = await fetchMessages({ conversationId: { eq: conversationId }, occurredAt: { lt: earliest.occurredAt } });
      publish({ messages: mergeRows(state.messages, older, byMessageTime), hasMore: older.length === PAGE });
    },
    close: () => {
      closed = true;
      unsubscribe();
    },
  };
};

let templatesRequest: Promise<TemplateOption[]> | null = null;

export type TemplateOption = { name: string; language: string; category: string; body: string; parameters: string[]; quickReplies: string[]; status: string };

export const loadTemplates = () => {
  templatesRequest ??= callWhatsApp<{ templates: TemplateOption[] }>({ action: 'templates' }).then((result) => result.templates);
  templatesRequest.catch(() => (templatesRequest = null));
  return templatesRequest;
};

export const newMessageId = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
