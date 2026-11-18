import { describe, expect, it } from 'vitest';

import { byMessageTime, createSseParser, matchesFilter, mergeRows, reconnectDelay, relativeTime, type SseEvent, tickState } from 'src/lib/thread';

type Row = { id: string; occurredAt: string; status: string };

describe('merging live changes', () => {
  const first: Row = { id: 'a', occurredAt: '2026-11-18T10:00:00Z', status: 'SENT' };
  const second: Row = { id: 'b', occurredAt: '2026-11-18T10:01:00Z', status: 'SENT' };

  it('keeps the same list and rows when nothing changed', () => {
    const rows = [first, second];
    expect(mergeRows(rows, [{ ...first }], byMessageTime)).toBe(rows);
  });

  it('replaces only the changed row, adds new ones in order and drops removed ones', () => {
    const rows = [second];
    const merged = mergeRows(rows, [first], byMessageTime);
    expect(merged.map((row) => row.id)).toEqual(['a', 'b']);
    expect(merged[1]).toBe(second);
    const updated = mergeRows(merged, [{ ...second, status: 'READ' }], byMessageTime);
    expect(updated[0]).toBe(first);
    expect(updated[1]?.status).toBe('READ');
    expect(mergeRows(updated, [], byMessageTime, () => true, ['a']).map((row) => row.id)).toEqual(['b']);
    expect(mergeRows(updated, [{ ...first, status: 'X' }], byMessageTime, (row) => row.status !== 'X').map((row) => row.id)).toEqual(['b']);
  });
});

describe('inbox filters', () => {
  it('sorts conversations into mine, unassigned, all and closed', () => {
    const open = { status: 'OPEN' as const, assigneeId: 'me' };
    expect(matchesFilter(open, 'mine', 'me')).toBe(true);
    expect(matchesFilter(open, 'mine', 'other')).toBe(false);
    expect(matchesFilter({ ...open, assigneeId: null }, 'unassigned', 'me')).toBe(true);
    expect(matchesFilter(open, 'all', null)).toBe(true);
    expect(matchesFilter({ ...open, status: 'CLOSED' }, 'all', 'me')).toBe(false);
    expect(matchesFilter({ ...open, status: 'CLOSED' }, 'closed', 'me')).toBe(true);
  });
});

describe('message ticks', () => {
  it('shows sending, waiting, sent, delivered, read and failed', () => {
    expect(tickState({ status: null, retryAt: null, error: null }, 'sending')).toBe('sending');
    expect(tickState({ status: 'QUEUED', retryAt: '2026-11-18T10:00:00Z', error: 'A teammate is chatting' }, null)).toBe('waiting');
    expect(tickState({ status: 'SENT', retryAt: null, error: null }, null)).toBe('sent');
    expect(tickState({ status: 'DELIVERED', retryAt: null, error: null }, null)).toBe('delivered');
    expect(tickState({ status: 'READ', retryAt: null, error: null }, null)).toBe('read');
    expect(tickState({ status: 'FAILED', retryAt: null, error: 'x' }, null)).toBe('failed');
    expect(tickState({ status: null, retryAt: null, error: null }, 'failed')).toBe('failed');
  });
});

describe('times', () => {
  const now = Date.parse('2026-11-18T15:00:00');
  it('reads like a messaging app', () => {
    expect(relativeTime(new Date(now - 20_000).toISOString(), now)).toBe('now');
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5 min');
    expect(relativeTime(new Date(Date.parse('2026-11-17T20:00:00')).toISOString(), now)).toBe('Yesterday');
    expect(relativeTime(null, now)).toBe('');
  });
});

describe('realtime stream', () => {
  it('backs off from one second to thirty, with jitter', () => {
    expect(reconnectDelay(0, 0.5)).toBe(1000);
    expect(reconnectDelay(3, 0.5)).toBe(8000);
    expect(reconnectDelay(10, 0.5)).toBe(30_000);
    expect(reconnectDelay(0, 0)).toBe(750);
    expect(reconnectDelay(0, 1)).toBe(1250);
  });

  it('parses events split across chunks and reports heartbeats', () => {
    const events: SseEvent[] = [];
    let pings = 0;
    const parse = createSseParser((event) => events.push(event), () => (pings += 1));
    parse(': ping\n\nevent: change\nid: 4');
    parse('2\ndata: {"topic":"whatsapp","kind":"message",');
    parse('"ids":["m1"]}\r\n\r\nevent: resync\ndata:\n\n');
    expect(pings).toBe(1);
    expect(events).toEqual([
      { event: 'change', id: '42', data: '{"topic":"whatsapp","kind":"message","ids":["m1"]}' },
      { event: 'resync', id: '42', data: '' },
    ]);
  });
});
