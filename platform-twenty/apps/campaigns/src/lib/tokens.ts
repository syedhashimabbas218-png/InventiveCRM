import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const secret = () => {
  const value = process.env.CAMPAIGN_LINK_SECRET;
  if (!value || value.length < 32) throw new Error('CAMPAIGN_LINK_SECRET must be set (at least 32 characters).');
  return value;
};

export const workspaceIdFromToken = (token: string | undefined) => {
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { workspaceId?: unknown };
    return typeof claims.workspaceId === 'string' && claims.workspaceId ? claims.workspaceId : null;
  } catch {
    return null;
  }
};

// The secret is shared by the whole server; links are signed with a key derived for this workspace so a link from
// one client never works in another.
const workspaceKey = () => {
  const workspaceId = workspaceIdFromToken(process.env.TWENTY_APP_APPLICATION_ACCESS_TOKEN) ?? workspaceIdFromToken(process.env.TWENTY_APP_ACCESS_TOKEN);
  if (!workspaceId) throw new Error('The workspace of this request is unknown, so no link can be signed or checked.');
  return createHmac('sha256', secret()).update(`workspace:${workspaceId}`).digest();
};

const mac = (value: string) => createHmac('sha256', workspaceKey()).update(value).digest('base64url').slice(0, 32);

export const newNonce = () => randomBytes(12).toString('base64url');

// Unsubscribe links carry the recipient id and a MAC over its per-recipient nonce.
export const recipientToken = (recipientId: string, nonce: string) => `${recipientId}.${mac(`unsubscribe:${recipientId}:${nonce}`)}`;

export const parseRecipientToken = (token: string) => {
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{32})$/.exec(token);
  return match ? { recipientId: match[1], signature: match[2] } : null;
};

const sameMac = (expected: string, given: string) => {
  const left = Buffer.from(expected);
  const right = Buffer.from(given);
  return left.length === right.length && timingSafeEqual(left, right);
};

export const verifyRecipientToken = (token: string, nonce: string | null | undefined) => {
  const parsed = parseRecipientToken(token);
  return Boolean(parsed && nonce && sameMac(mac(`unsubscribe:${parsed.recipientId}:${nonce}`), parsed.signature));
};

// Resend posts events to a URL carrying this token, so only someone who was given the URL can report events.
export const webhookToken = () => mac('resend-webhook');

export const verifyWebhookToken = (token: string) => /^[A-Za-z0-9_-]{32}$/.test(token) && sameMac(webhookToken(), token);
