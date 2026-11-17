import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isOverLimit, rateLimit, RateLimitedError, rateWindow } from 'src/lib/rate-limit';

type CounterRow = { key: string; bucket: string; windowStart: string };

const rows: CounterRow[] = [];
const pause = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 3));

vi.mock('src/lib/api', () => ({
  gql: async (query: string, variables: { data?: CounterRow; bucket?: string; windowStart?: string }) => {
    await pause();
    if (query.includes('createPublicRequestCounter')) {
      if (rows.some((row) => row.key === variables.data?.key)) throw new Error('duplicate key value violates unique constraint');
      rows.push(variables.data as CounterRow);
      return { createPublicRequestCounter: { id: variables.data?.key } };
    }
    return { publicRequestCounters: { totalCount: rows.filter((row) => row.bucket === variables.bucket && row.windowStart === variables.windowStart).length } };
  },
}));

const settle = (promises: Promise<unknown>[]) => Promise.allSettled(promises);

describe('public rate limit', () => {
  beforeEach(() => {
    process.env.BOOKING_LINK_SECRET = 's'.repeat(40);
    rows.length = 0;
  });
  afterEach(() => {
    delete process.env.BOOKING_LINK_SECRET;
  });

  it('never lets more than the limit through when requests arrive at the same moment', async () => {
    for (let round = 0; round < 20; round += 1) {
      rows.length = 0;
      const results = await settle(Array.from({ length: 25 }, () => rateLimit({ 'x-forwarded-for': '10.0.0.1' }, 'book', 10, 3600)));
      expect(results.filter((result) => result.status === 'fulfilled').length).toBeLessThanOrEqual(10);
      expect(results.filter((result) => result.status === 'rejected').every((result) => (result as PromiseRejectedResult).reason instanceof RateLimitedError)).toBe(true);
    }
  });

  it('lets simultaneous requests within the limit through', async () => {
    const results = await settle(Array.from({ length: 8 }, () => rateLimit({ 'x-forwarded-for': '10.0.0.6' }, 'book', 10, 3600)));
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
  });

  it('allows the limit in sequence and refuses the next ones', async () => {
    const statuses: string[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1)
      statuses.push(await rateLimit({ 'x-forwarded-for': '10.0.0.2' }, 'book', 10, 3600).then(() => 'ok', () => 'limited'));
    expect(statuses).toEqual([...Array(10).fill('ok'), 'limited', 'limited']);
  });

  it('counts each client and each bucket separately', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) await rateLimit({ 'x-forwarded-for': '10.0.0.3' }, 'slots', 3, 60);
    await expect(rateLimit({ 'x-forwarded-for': '10.0.0.3' }, 'slots', 3, 60)).rejects.toBeInstanceOf(RateLimitedError);
    await expect(rateLimit({ 'x-forwarded-for': '10.0.0.4' }, 'slots', 3, 60)).resolves.toBeUndefined();
    await expect(rateLimit({ 'x-forwarded-for': '10.0.0.3' }, 'page', 3, 60)).resolves.toBeUndefined();
  });

  it('turns a client already over the limit away without writing another row', async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) await rateLimit({ 'x-forwarded-for': '10.0.0.5' }, 'manage', 2, 60);
    const before = rows.length;
    await expect(rateLimit({ 'x-forwarded-for': '10.0.0.5' }, 'manage', 2, 60)).rejects.toBeInstanceOf(RateLimitedError);
    expect(rows.length).toBe(before);
  });

  it('works out the window and the wait until it ends', () => {
    const at = Date.UTC(2026, 10, 17, 10, 59, 30);
    expect(rateWindow(at, 3600)).toEqual({ start: Date.UTC(2026, 10, 17, 10, 0, 0), retryAfterSeconds: 30 });
    expect(rateWindow(at, 60)).toEqual({ start: Date.UTC(2026, 10, 17, 10, 59, 0), retryAfterSeconds: 30 });
    expect(isOverLimit(10, 10)).toBe(false);
    expect(isOverLimit(11, 10)).toBe(true);
  });
});
