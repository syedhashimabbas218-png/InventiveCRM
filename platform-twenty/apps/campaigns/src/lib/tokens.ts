import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

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
  const [, recipientId, signature] = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{32})$/.exec(token) ?? [];
  return recipientId && signature ? { recipientId, signature } : null;
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

const sealingKey = () => createHmac('sha256', workspaceKey()).update('sealed-settings').digest();

// Settings the app keeps in records anyone in the workspace can read. The context names what the value is for, so a
// sealed value copied into another field does not open.
export const sealText = (text: string, context: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sealingKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const sealed = Buffer.concat([cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `v1.${iv.toString('base64url')}.${sealed.toString('base64url')}`;
};

export const openText = (stored: string | null | undefined, context: string) => {
  const [version, iv, payload] = (stored ?? '').split('.');
  if (version !== 'v1' || !iv || !payload) return null;
  try {
    const data = Buffer.from(payload, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', sealingKey(), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(data.subarray(data.length - 16));
    return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
};

const SIGNATURE_TOLERANCE_SECONDS = 300;

// Resend signs webhooks the Svix way: HMAC-SHA256 over "id.timestamp.body" with the key inside whsec_..., and the
// header may list several signatures while a secret is being rotated.
export const verifySvixSignature = (signingSecret: string, id: string, timestamp: string, signatures: string, rawBody: string) => {
  if (!/^\d{1,12}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const key = Buffer.from(signingSecret.replace(/^whsec_/, ''), 'base64');
  if (key.length === 0) return false;
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64');
  return signatures.split(' ').some((entry) => {
    const [version, value] = entry.split(',');
    return version === 'v1' && Boolean(value) && sameMac(expected, value ?? '');
  });
};
