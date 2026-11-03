import { gql, nodes } from 'src/lib/api';
import { clientFingerprint } from 'src/lib/tokens';

// Twenty only throttles a whole workspace, so a flood on a public page would starve every other function.
// These per-client counters stop that early. Clients are a keyed hash of their address, never the address itself.
export const clientAddress = (headers: Record<string, string | undefined>) =>
  (headers['x-forwarded-for'] ?? headers['x-real-ip'] ?? 'unknown').split(',')[0].trim();

export class RateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests. Please wait a moment and try again.');
  }
}

export const rateLimit = async (headers: Record<string, string | undefined>, bucket: string, limit: number, windowSeconds: number) => {
  const windowStart = Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000;
  const key = `${bucket}|${clientFingerprint(clientAddress(headers))}|${windowStart}`;
  try {
    await gql(`mutation($data: PublicRequestCounterCreateInput!) { createPublicRequestCounter(data: $data) { id } }`, {
      data: { key, count: 1, windowStart: new Date(windowStart).toISOString() },
    });
    return;
  } catch (error) {
    if (!/duplicate|unique constraint/i.test((error as Error).message)) throw error;
  }
  const data = await gql<{ publicRequestCounters: { edges: { node: { id: string; count: number } }[] } }>(
    `query($key: String!) { publicRequestCounters(filter: { key: { eq: $key } }, first: 1) { edges { node { id count } } } }`,
    { key },
  );
  const counter = nodes(data.publicRequestCounters)[0];
  if (!counter) return;
  if (counter.count >= limit) throw new RateLimitedError(Math.ceil((windowStart + windowSeconds * 1000 - Date.now()) / 1000));
  await gql(`mutation($id: UUID!, $data: PublicRequestCounterUpdateInput!) { updatePublicRequestCounter(id: $id, data: $data) { id } }`, {
    id: counter.id,
    data: { count: counter.count + 1 },
  });
};

export const purgeOldCounters = (olderThan: number) =>
  gql(`mutation($before: DateTime!) { destroyPublicRequestCounters(filter: { windowStart: { lt: $before } }) { id } }`, { before: new Date(olderThan).toISOString() });
