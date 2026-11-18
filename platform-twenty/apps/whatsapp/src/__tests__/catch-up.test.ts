import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ lease: true, handlerMs: 0, updates: [] as Record<string, unknown>[], handled: [] as string[], recorded: [] as { inventiveChatMessageId: string; status: string; conversationId: string }[] }));

vi.mock('src/lib/settings', () => ({
  leaseCatchUp: async () => state.lease,
  updateSettings: async (_id: string, data: Record<string, unknown>) => {
    state.updates.push(data);
  },
}));

vi.mock('src/lib/records', () => ({
  messagesByInventiveChatIds: async (ids: string[]) => state.recorded.filter((row) => ids.includes(row.inventiveChatMessageId)),
}));

vi.mock('src/lib/events', () => ({
  handleWebhook: async (parsed: { event: { kind: string; idempotencyKey?: string; message?: { messageId: string } } }) => {
    if (state.handlerMs) await new Promise((resolve) => setTimeout(resolve, state.handlerMs));
    state.handled.push(parsed.event.idempotencyKey ?? parsed.event.message?.messageId ?? parsed.event.kind);
    return {};
  },
}));

const { catchUp } = await import('src/lib/catch-up');
const { createChangeSet } = await import('src/lib/realtime');

const SETTINGS = { id: 'settings-1', tenantId: 'ten_1', eventCursor: 'c10', eventsCheckedAt: '2026-11-18T08:00:00.000Z', eventsProblem: null } as unknown as Parameters<typeof catchUp>[0];
const CONTEXT = { key: 'wa_test_key', tenantId: 'ten_1' };

const envelope = (type: string, data: Record<string, unknown>, { tenant = 'ten_1', at = '2026-11-18T09:00:00.000Z' } = {}) => ({ tenant_id: tenant, actor: { type: 'system', id: 'x' }, correlation_id: 'cor_abcdefgh', idempotency_key: `evt_${Math.random()}`, occurred_at: at, payload: { type, data } });
const unknownOutcome = (key: string, options?: { tenant?: string; at?: string }) => envelope('message.send_outcome_unknown', { idempotency_key: key }, options);
const received = (id: string, status = 'delivered') => envelope('message.status_updated', { status, message: { id, conversation_id: 'conv_1', direction: 'inbound', customer: '447700900123', type: 'text', text: 'hi', status } });

let feedRequests: string[] = [];

const fakeFeed = (pages: Record<string, () => Response>, delayMs = 0) =>
  vi.stubGlobal('fetch', async (url: string) => {
    const address = new URL(url);
    const key = `${address.pathname.replace(/^\/v1/, '')}?${address.searchParams.get('after') ?? ''}`;
    feedRequests.push(key);
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const answer = pages[key];
    return answer ? answer() : Response.json({ reason: 'not_found' }, { status: 404 });
  });

const page = (events: unknown[], next: string | null, hasMore: boolean) => () => Response.json({ events: events.map((event, index) => ({ cursor: `x${index}`, event })), next_cursor: next, has_more: hasMore });

beforeEach(() => {
  Object.assign(state, { lease: true, handlerMs: 0, updates: [], handled: [], recorded: [] });
  feedRequests = [];
  process.env.INVENTIVECHAT_API_URL = 'http://inventivechat.test';
});

afterEach(() => vi.unstubAllGlobals());

describe('catching up on the event feed', () => {
  it('reads every page from the stored position, applies each event and stores the new position', async () => {
    fakeFeed({ '/events/feed?c10': page([unknownOutcome('a'), unknownOutcome('b')], 'c12', true), '/events/feed?c12': page([unknownOutcome('c')], 'c13', false) });
    const outcome = await catchUp(SETTINGS, CONTEXT, Date.now() + 10_000, createChangeSet());
    expect(outcome).toMatchObject({ applied: 3, pages: 2, caughtUp: true });
    expect(state.handled).toEqual(['a', 'b', 'c']);
    expect(state.updates.filter((update) => 'eventCursor' in update).map((update) => update.eventCursor)).toEqual(['c12', 'c13']);
    expect(state.updates.at(-2)).toHaveProperty('eventsCheckedAt');
    expect(state.updates.at(-1)).toEqual({ catchUpLeaseUntil: null });
  });

  it('a connection without a position starts at the newest event, without replaying older ones', async () => {
    fakeFeed({ '/events/feed?latest': page([], 'c99', false) });
    const outcome = await catchUp({ ...SETTINGS, eventCursor: null }, CONTEXT, Date.now() + 10_000, createChangeSet());
    expect(outcome).toMatchObject({ applied: 0, caughtUp: true });
    expect(state.updates[0]).toMatchObject({ eventCursor: 'c99' });
    expect(state.handled).toEqual([]);
  });

  it('skips messages a webhook already recorded at that status, with one lookup per page', async () => {
    state.recorded = [
      { inventiveChatMessageId: 'msg_done', status: 'DELIVERED', conversationId: 'crm-1' },
      { inventiveChatMessageId: 'msg_later', status: 'DELIVERED', conversationId: 'crm-1' },
    ];
    fakeFeed({ '/events/feed?c10': page([received('msg_done'), received('msg_later', 'read'), received('msg_new')], 'c13', false) });
    const outcome = await catchUp(SETTINGS, CONTEXT, Date.now() + 10_000, createChangeSet());
    expect(outcome).toMatchObject({ applied: 2, duplicates: 1 });
    expect(state.handled).toEqual(['msg_later', 'msg_new']);
  });

  it('ignores events for another InventiveChat account', async () => {
    fakeFeed({ '/events/feed?c10': page([unknownOutcome('a', { tenant: 'ten_other' }), unknownOutcome('b')], 'c12', false) });
    expect(await catchUp(SETTINGS, CONTEXT, Date.now() + 10_000, createChangeSet())).toMatchObject({ applied: 1, ignored: 1 });
  });

  it('stopping halfway through a page keeps the position of the last event applied', async () => {
    state.handlerMs = 60;
    fakeFeed({ '/events/feed?c10': page([unknownOutcome('a'), unknownOutcome('b'), unknownOutcome('c'), unknownOutcome('d')], 'c14', true) });
    const outcome = await catchUp(SETTINGS, CONTEXT, Date.now() + 100, createChangeSet());
    expect(outcome).toMatchObject({ caughtUp: false });
    const applied = state.handled.length;
    expect(applied).toBeGreaterThan(0);
    expect(applied).toBeLessThan(4);
    expect(state.updates[0]).toEqual({ eventCursor: `x${applied - 1}` });
  });

  it('does not move at all when nothing on the page was applied', async () => {
    fakeFeed({ '/events/feed?c10': page([unknownOutcome('a'), unknownOutcome('b')], 'c12', true) }, 150);
    const outcome = await catchUp(SETTINGS, CONTEXT, Date.now() + 100, createChangeSet());
    expect(feedRequests).toEqual(['/events/feed?c10']);
    expect(outcome).toMatchObject({ applied: 0, caughtUp: false });
    expect(state.updates.some((update) => 'eventCursor' in update)).toBe(false);
  });

  it('after a position InventiveChat has pruned, says events may be missing and replays everything it still keeps', async () => {
    fakeFeed({ '/events/feed?c10': () => Response.json({ reason: 'cursor_expired' }, { status: 410 }), '/events/feed?': page([unknownOutcome('z', { at: '2026-11-11T09:00:00.000Z' })], 'c40', false) });
    const outcome = await catchUp(SETTINGS, CONTEXT, Date.now() + 10_000, createChangeSet());
    expect(outcome).toMatchObject({ applied: 1, caughtUp: true });
    expect(feedRequests).toEqual(['/events/feed?c10', '/events/feed?']);
    expect(String(state.updates[0]?.eventsProblem)).toMatch(/after 2026-11-18T08:00:00.000Z were kept by InventiveChat for 7 days only/);
    expect(state.updates[0]?.eventCursor).toBe('c40');
  });

  it('leaves the feed alone while another run holds the lease', async () => {
    state.lease = false;
    fakeFeed({});
    expect(await catchUp(SETTINGS, CONTEXT, Date.now() + 10_000, createChangeSet())).toEqual({ skipped: 'another run is catching up' });
    expect(feedRequests).toEqual([]);
  });
});
