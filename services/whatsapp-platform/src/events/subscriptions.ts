import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { decryptToken, encryptToken, type TokenKey } from '../crypto/token-cipher.ts';
import { withTenant, type Database, type TenantClient } from '../db/pool.ts';
import { BUSINESS_EVENT_TYPES, type BusinessEvent, type BusinessEventType, type EventBus } from '../interfaces/event-bus.ts';
import { enqueueJob } from '../jobs/queue.ts';
import type { JobHandler } from '../jobs/worker.ts';
import type { Clock } from '../shared/clock.ts';
import { newId } from '../shared/ids.ts';

const DELIVERY_ATTEMPTS = 8;
const DELIVERY_TIMEOUT_MS = 10_000;

export type SubscriptionOptions = { allowInsecureUrls: boolean };

const isPrivateAddress = (host: string): boolean => {
  const bare = host.replace(/^\[|\]$/g, '');
  if (isIP(bare) === 4) {
    const [first = 0, second = 0] = bare.split('.').map(Number);
    return first === 10 || first === 127 || first === 0 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
  }
  if (isIP(bare) === 6) return bare === '::1' || /^f[cd]/i.test(bare) || /^fe80/i.test(bare) || bare.startsWith('::ffff:');
  return bare === 'localhost' || bare.endsWith('.localhost') || bare.endsWith('.internal');
};

// Only literal hosts are checked; DNS that resolves to a private address is not caught here.
export const validateSubscriptionUrl = (url: string, options: SubscriptionOptions): string | undefined => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'url is not valid';
  }
  if (options.allowInsecureUrls) return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? undefined : 'url must be http(s)';
  if (parsed.protocol !== 'https:') return 'url must use https';
  if (parsed.username || parsed.password) return 'url must not contain credentials';
  if (isPrivateAddress(parsed.hostname)) return 'url must not point at a private or local address';
  return undefined;
};

export const isBusinessEventType = (value: unknown): value is BusinessEventType =>
  typeof value === 'string' && (BUSINESS_EVENT_TYPES as readonly string[]).includes(value);

export const createSubscription = async (
  client: TenantClient,
  input: { url: string; eventTypes: BusinessEventType[] },
  key: TokenKey,
  now: Date,
): Promise<{ id: string; secret: string }> => {
  const id = newId('sub');
  const secret = `whsec_${randomBytes(32).toString('hex')}`;
  const encrypted = encryptToken(key, client.tenantId, secret);
  await client.query(
    `INSERT INTO event_subscriptions (id, tenant_id, url, secret_ciphertext, secret_key_id, event_types, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, client.tenantId, input.url, encrypted.ciphertext, encrypted.keyId, input.eventTypes, now],
  );
  return { id, secret };
};

export const listSubscriptions = async (client: TenantClient) =>
  (
    await client.query<{ id: string; url: string; event_types: string[]; status: string; created_at: Date }>(
      'SELECT id, url, event_types, status, created_at FROM event_subscriptions WHERE tenant_id = $1 ORDER BY created_at',
      [client.tenantId],
    )
  ).rows;

export const disableSubscription = async (client: TenantClient, id: string): Promise<boolean> =>
  ((
    await client.query("UPDATE event_subscriptions SET status = 'disabled' WHERE tenant_id = $1 AND id = $2", [client.tenantId, id])
  ).rowCount ?? 0) > 0;

// Receivers recompute this over `${timestamp}.${raw body}` and reject stale timestamps.
export const signEventBody = (secret: string, timestamp: string, body: string): string =>
  `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

// Publishing writes one delivery job per matching subscription, so delivery survives restarts and retries.
export const createSubscriptionEventBus = (database: Database, clock: Clock): EventBus => ({
  publish: async (event) => {
    await withTenant(database, event.tenant_id, async (client) => {
      const subscriptions = await client.query<{ id: string }>(
        "SELECT id FROM event_subscriptions WHERE tenant_id = $1 AND status = 'active' AND $2 = ANY (event_types)",
        [event.tenant_id, event.payload.type],
      );
      for (const subscription of subscriptions.rows) {
        await enqueueJob(client, {
          kind: 'event.deliver',
          payload: { subscription_id: subscription.id, event },
          idempotencyKey: `deliver:${subscription.id}:${event.idempotency_key}`,
          runAt: clock(),
          maxAttempts: DELIVERY_ATTEMPTS,
        });
      }
    });
  },
});

export const createDeliveryHandler =
  (deps: { database: Database; clock: Clock; tokenKeys: readonly TokenKey[] }): JobHandler =>
  async (job) => {
    const event = job.payload.event as BusinessEvent;
    const subscription = await withTenant(deps.database, job.tenant_id, async (client) =>
      (
        await client.query<{ url: string; secret_ciphertext: Buffer; secret_key_id: string; status: string }>(
          'SELECT url, secret_ciphertext, secret_key_id, status FROM event_subscriptions WHERE tenant_id = $1 AND id = $2',
          [job.tenant_id, String(job.payload.subscription_id)],
        )
      ).rows[0],
    );
    if (!subscription || subscription.status !== 'active') return;

    const secret = decryptToken(deps.tokenKeys, job.tenant_id, { keyId: subscription.secret_key_id, ciphertext: subscription.secret_ciphertext });
    const body = JSON.stringify(event);
    const timestamp = String(Math.floor(deps.clock().getTime() / 1000));
    const response = await fetch(subscription.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-event-id': event.idempotency_key,
        'x-event-type': event.payload.type,
        'x-signature-timestamp': timestamp,
        'x-signature-256': signEventBody(secret, timestamp, body),
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`subscriber answered ${response.status}`);
  };
