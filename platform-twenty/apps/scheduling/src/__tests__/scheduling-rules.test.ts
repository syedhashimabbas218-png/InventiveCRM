import { describe, expect, it } from 'vitest';

import { haversineKm, snapToGrid } from 'src/engine/geo';
import { dueReminderIntervals, largestReminderMinutes, reminderIntervals, withRemindersSent } from 'src/engine/reminders';
import { isSeatKey, seatKey, seatOrder } from 'src/engine/slots';
import { MINUTE } from 'src/engine/time';
import { mapWithConcurrency } from 'src/lib/concurrency';
import { allPages } from 'src/lib/pagination';
import { refuseUnlessSignedIn } from 'src/lib/route-access';
import { backoffMinutesAfter, MAX_SYNC_ATTEMPTS } from 'src/lib/sync';

describe('group session seats', () => {
  it('tries every seat, the free-looking ones first', () => {
    expect(seatOrder(3, 0)).toEqual([1, 2, 3]);
    expect(seatOrder(3, 1)).toEqual([2, 3, 1]);
    expect(seatOrder(4, 2)).toEqual([3, 4, 1, 2]);
  });

  it('still offers a seat freed by a cancellation when the count says the session is full', () => {
    expect(seatOrder(3, 3)).toEqual([1, 2, 3]);
    expect(seatOrder(3, 5)).toEqual([1, 2, 3]);
  });

  it('tells seat rows apart from the host time', () => {
    expect(isSeatKey(seatKey('type|advisor|2026-11-20T10:00:00.000Z', 2))).toBe(true);
    expect(isSeatKey('advisor|2026-11-20T10:00:00.000Z')).toBe(false);
  });
});

describe('public location grid', () => {
  it('rounds a customer point to 0.01 degree', () => {
    expect(snapToGrid({ lat: 53.8206, lng: -1.5772 })).toEqual({ lat: 53.82, lng: -1.58 });
    expect(snapToGrid({ lat: 53.8249, lng: -1.5751 })).toEqual({ lat: 53.82, lng: -1.58 });
  });

  it('answers the same for every point in a grid cell, and stays within about a kilometre', () => {
    const points = [
      { lat: 51.50351, lng: -0.12761 },
      { lat: 51.50449, lng: -0.12549 },
    ];
    const snapped = points.map(snapToGrid);
    expect(snapped[0]).toEqual(snapped[1]);
    for (const [index, point] of points.entries()) expect(haversineKm(point, snapped[index]!)).toBeLessThan(1);
  });
});

describe('reminders', () => {
  const start = Date.UTC(2026, 10, 20, 10, 0);

  it('reads the interval list leniently', () => {
    expect(reminderIntervals('1440, 60,,x,-5')).toEqual([1440, 60]);
    expect(reminderIntervals(null)).toEqual([]);
  });

  it('scans only as far ahead as the longest interval of any type', () => {
    expect(largestReminderMinutes(['1440,60', '', null, '2880'])).toBe(2880);
    expect(largestReminderMinutes(['', null])).toBe(0);
  });

  it('sends each interval once, and only once it is due', () => {
    expect(dueReminderIntervals('1440,60', '', start, start - 2000 * MINUTE)).toEqual([]);
    expect(dueReminderIntervals('1440,60', '', start, start - 1000 * MINUTE)).toEqual([1440]);
    expect(dueReminderIntervals('1440,60', '1440', start, start - 1000 * MINUTE)).toEqual([]);
    expect(dueReminderIntervals('1440,60', '1440', start, start - 30 * MINUTE)).toEqual([60]);
  });

  it('records several due intervals together, largest first', () => {
    expect(dueReminderIntervals('1440,60', null, start, start - 30 * MINUTE)).toEqual([1440, 60]);
    expect(withRemindersSent('1440', [60])).toBe('1440,60');
    expect(withRemindersSent(null, [60, 1440])).toBe('1440,60');
  });
});

describe('calendar sync retries', () => {
  it('backs off and then gives up', () => {
    expect(backoffMinutesAfter(1)).toBe(1);
    expect(backoffMinutesAfter(4)).toBe(60);
    expect(backoffMinutesAfter(MAX_SYNC_ATTEMPTS - 1)).toBe(240);
    expect(backoffMinutesAfter(MAX_SYNC_ATTEMPTS)).toBeNull();
  });
});

describe('advisor search helpers', () => {
  it('keeps at most the given number of advisors in flight and keeps their order', async () => {
    let inFlight = 0;
    let most = 0;
    const results = await mapWithConcurrency(Array.from({ length: 20 }, (_, index) => index), 6, async (value) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
      inFlight -= 1;
      return value * 2;
    });
    expect(most).toBe(6);
    expect(results).toEqual(Array.from({ length: 20 }, (_, index) => index * 2));
    expect(await mapWithConcurrency([], 6, async (value: number) => value)).toEqual([]);
  });

  it('reads every page instead of stopping at the first', async () => {
    const pages: Record<string, { edges: { node: number }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }> = {
      start: { edges: [{ node: 1 }, { node: 2 }], pageInfo: { hasNextPage: true, endCursor: 'a' } },
      a: { edges: [{ node: 3 }], pageInfo: { hasNextPage: true, endCursor: 'b' } },
      b: { edges: [{ node: 4 }], pageInfo: { hasNextPage: false, endCursor: 'c' } },
    };
    expect(await allPages(async (after) => pages[after ?? 'start']!)).toEqual([1, 2, 3, 4]);
  });
});

describe('job routes', () => {
  const route = (userWorkspaceId: string | null) => ({ requestContext: { http: { method: 'POST', path: '/scheduling/sync-now' } }, userWorkspaceId });

  it('refuses a route call that is not made by a signed-in person', () => {
    expect(refuseUnlessSignedIn(route(null))?.status).toBe(403);
    expect(refuseUnlessSignedIn(route(''))?.status).toBe(403);
  });

  it('lets signed-in people and cron runs through', () => {
    expect(refuseUnlessSignedIn(route('11111111-1111-4111-8111-111111111111'))).toBeNull();
    expect(refuseUnlessSignedIn({})).toBeNull();
    expect(refuseUnlessSignedIn(undefined)).toBeNull();
  });
});
