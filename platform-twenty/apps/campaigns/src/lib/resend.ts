import { createHash } from 'node:crypto';

import { listConnections } from 'twenty-sdk/logic-function';

export const RESEND_CONNECTION_NAME = 'resend-campaigns';
export const BATCH_SIZE = 100;

export const WEBHOOK_EVENTS = ['email.delivered', 'email.bounced', 'email.complained', 'email.opened', 'email.clicked', 'email.failed', 'email.suppressed'];

const base = () => (process.env.RESEND_API_URL || 'https://api.resend.com').replace(/\/$/, '');

export class ResendError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }
}

const QUOTA_CODES = ['daily_quota_exceeded', 'monthly_quota_exceeded'];

export const isQuotaReached = (error: unknown) => error instanceof ResendError && QUOTA_CODES.includes(error.code);

// Resend turned the whole request away before taking any of it: a rate or plan limit, or a key it no longer accepts.
export const refusedOutright = (error: unknown) => error instanceof ResendError && (error.status === 429 || error.status === 401 || error.status === 403);

// The key was used within the last 24 hours with a different body: Resend sent the first request, our record of it was lost.
export const acceptedEarlier = (error: unknown) => error instanceof ResendError && error.status === 409 && error.code === 'invalid_idempotent_request';

// The single message is wrong (bad address, missing field); the rest of the batch can still go.
export const isInvalidMessage = (error: unknown) => error instanceof ResendError && (error.status === 400 || error.status === 422);

const MAX_RETRY_WAIT_SECONDS = 10;

// A short "retry after" is worth waiting for within the run; a plan quota or a long wait pauses the campaign instead.
export const retryDelayMs = (error: unknown) =>
  error instanceof ResendError && error.status === 429 && !isQuotaReached(error) && error.retryAfterSeconds !== null && error.retryAfterSeconds <= MAX_RETRY_WAIT_SECONDS ? error.retryAfterSeconds * 1000 : null;

export const keyFingerprint = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 16);

const call = async <TResult>(key: string, method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, idempotencyKey?: string): Promise<TResult> => {
  const response = await fetch(`${base()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'User-Agent': 'InventiveCRM-Campaigns/0.1',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await response.json().catch(() => ({}))) as TResult & { name?: string; message?: string };
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('retry-after'));
    throw new ResendError(`Resend answered ${response.status}: ${data.message ?? 'request failed'}`, response.status, data.name ?? '', Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null);
  }
  return data;
};

export type ResendDomain = { id: string; name: string; status: string; openTracking: boolean; clickTracking: boolean };

export const listDomains = async (key: string): Promise<ResendDomain[]> => {
  const result = await call<{ data?: { id: string; name: string; status: string; open_tracking?: boolean; click_tracking?: boolean }[] }>(key, 'GET', '/domains');
  return (result.data ?? []).map((domain) => ({ id: domain.id, name: domain.name, status: domain.status, openTracking: Boolean(domain.open_tracking), clickTracking: Boolean(domain.click_tracking) }));
};

// Only full-access keys can list domains, and Studio needs that to offer sending addresses and set up tracking.
export const validateKey = async (key: string) => {
  if (!/^re_[A-Za-z0-9_]{10,}$/.test(key)) throw new ResendError('That does not look like a Resend API key (re_...).', 400, 'invalid_key');
  try {
    const domains = await listDomains(key);
    return { fingerprint: keyFingerprint(key), domains };
  } catch (error) {
    if (error instanceof ResendError && (error.status === 401 || error.status === 403))
      throw new ResendError('Resend refused the key. Create a key with Full access, not Sending access.', error.status, 'restricted_api_key');
    throw error;
  }
};

const workingConnections = async () => (await listConnections({ providerName: RESEND_CONNECTION_NAME, scope: 'WORKSPACE' }).catch(() => [])).filter((connection) => connection.accessToken && !connection.authFailedAt);

export const isKeyConnected = async (fingerprint: string) => (await workingConnections()).some((connection) => connection.externalAccountId === `resend-${fingerprint}`);

// Twenty lists connections in no set order; sorting keeps every run, and every retried batch, on the same account.
const currentConnection = async () => (await workingConnections()).sort((left, right) => left.id.localeCompare(right.id))[0] ?? null;

export const resendKey = async () => (await currentConnection())?.accessToken ?? null;

export const connectionLabel = async () => (await currentConnection())?.handle ?? null;

export type OutgoingEmail = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
  headers: Record<string, string>;
  tags: { name: string; value: string }[];
};

export const sendBatch = async (key: string, emails: OutgoingEmail[], idempotencyKey: string) => {
  const result = await call<{ data?: { id: string }[] }>(key, 'POST', '/emails/batch', emails, idempotencyKey.slice(0, 256));
  return (result.data ?? []).map((entry) => entry.id);
};

export const sendOne = async (key: string, email: OutgoingEmail, idempotencyKey?: string) => (await call<{ id?: string }>(key, 'POST', '/emails', email, idempotencyKey)).id ?? null;

type Webhook = { id: string; endpoint: string; events?: string[] };

export const hasWebhook = async (key: string, endpoint: string) => ((await call<{ data?: Webhook[] }>(key, 'GET', '/webhooks')).data ?? []).some((webhook) => webhook.endpoint === endpoint);

export const ensureWebhook = async (key: string, endpoint: string) => {
  if (await hasWebhook(key, endpoint).catch(() => false)) return { created: false };
  await call(key, 'POST', '/webhooks', { endpoint, events: WEBHOOK_EVENTS });
  return { created: true };
};

// The list leaves the secret out, so the webhook is read on its own.
export const webhookSigningSecret = async (key: string, endpoint: string) => {
  const webhook = ((await call<{ data?: Webhook[] }>(key, 'GET', '/webhooks')).data ?? []).find((entry) => entry.endpoint === endpoint);
  if (!webhook) return null;
  return (await call<{ signing_secret?: string }>(key, 'GET', `/webhooks/${encodeURIComponent(webhook.id)}`)).signing_secret ?? null;
};

export const enableTracking = (key: string, domainId: string) => call(key, 'PATCH', `/domains/${encodeURIComponent(domainId)}`, { open_tracking: true, click_tracking: true });
