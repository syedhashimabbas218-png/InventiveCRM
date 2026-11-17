import { randomUUID } from 'node:crypto';

import { gql } from 'src/lib/api';
import { clientFingerprint } from 'src/lib/tokens';

// Twenty only throttles a whole workspace, so a flood on a public page would starve every other function.
// These per-client counters stop that early. Clients are a keyed hash of their address, never the address itself.
export const clientAddress = (headers: Record<string, string | undefined>) =>
  (headers['x-forwarded-for'] ?? headers['x-real-ip'] ?? 'unknown').split(',')[0]!.trim();

export class RateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests. Please wait a moment and try again.');
  }
}

export const rateWindow = (now: number, windowSeconds: number) => {
  const length = windowSeconds * 1000;
  const start = Math.floor(now / length) * length;
  return { start, retryAfterSeconds: Math.ceil((start + length - now) / 1000) };
};

export const isOverLimit = (requestsInWindow: number, limit: number) => requestsInWindow > limit;

// One row per request, counted after it is written: of any number of simultaneous requests, at most `limit` see a
// count within the limit. The first count turns a flood away before it writes anything.
export const rateLimit = async (headers: Record<string, string | undefined>, bucket: string, limit: number, windowSeconds: number) => {
  const window = rateWindow(Date.now(), windowSeconds);
  const client = `${bucket}|${clientFingerprint(clientAddress(headers))}`;
  const windowStart = new Date(window.start).toISOString();
  const requestsSoFar = async () =>
    (
      await gql<{ publicRequestCounters: { totalCount: number } }>(
        `query($bucket: String!, $windowStart: DateTime!) { publicRequestCounters(filter: { bucket: { eq: $bucket }, windowStart: { eq: $windowStart } }) { totalCount } }`,
        { bucket: client, windowStart },
      )
    ).publicRequestCounters.totalCount;
  if (isOverLimit((await requestsSoFar()) + 1, limit)) throw new RateLimitedError(window.retryAfterSeconds);
  await gql(`mutation($data: PublicRequestCounterCreateInput!) { createPublicRequestCounter(data: $data) { id } }`, {
    data: { key: `${client}|${window.start}|${randomUUID()}`, bucket: client, count: 1, windowStart },
  });
  if (isOverLimit(await requestsSoFar(), limit)) throw new RateLimitedError(window.retryAfterSeconds);
};

export const purgeOldCounters = (olderThan: number) =>
  gql(`mutation($before: DateTime!) { destroyPublicRequestCounters(filter: { windowStart: { lt: $before } }) { id } }`, { before: new Date(olderThan).toISOString() });
