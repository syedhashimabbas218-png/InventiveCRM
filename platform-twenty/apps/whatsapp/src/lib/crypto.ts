import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const appSecret = () => {
  const value = process.env.WHATSAPP_APP_SECRET;
  if (!value || value.length < 32) throw new Error('WHATSAPP_APP_SECRET must be set (at least 32 characters).');
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

export const currentWorkspaceId = () => workspaceIdFromToken(process.env.TWENTY_APP_APPLICATION_ACCESS_TOKEN) ?? workspaceIdFromToken(process.env.TWENTY_APP_ACCESS_TOKEN);

// One key per workspace and purpose, so a sealed value copied from one client's records is useless in another's.
const sealingKey = (purpose: string) => {
  const workspaceId = currentWorkspaceId();
  if (!workspaceId) throw new Error('The workspace of this request is unknown, so no secret can be sealed or opened.');
  const base = createHmac('sha256', appSecret()).update(`workspace:${workspaceId}`).digest();
  return createHmac('sha256', base).update(purpose).digest();
};

// The context names what the value is for, so a sealed value copied into another field or record does not open.
export const sealText = (text: string, context: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sealingKey('sealed-settings'), iv);
  cipher.setAAD(Buffer.from(context));
  const sealed = Buffer.concat([cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `v1.${iv.toString('base64url')}.${sealed.toString('base64url')}`;
};

export const openText = (stored: string | null | undefined, context: string) => {
  const [version, iv, payload] = (stored ?? '').split('.');
  if (version !== 'v1' || !iv || !payload) return null;
  try {
    const data = Buffer.from(payload, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', sealingKey('sealed-settings'), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(data.subarray(data.length - 16));
    return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
};

export const keyFingerprint = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 16);

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export const signBody = (secret: string, timestamp: string, rawBody: string) => `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;

export const sameText = (expected: string, given: string) => {
  const left = Buffer.from(expected);
  const right = Buffer.from(given);
  return left.length === right.length && timingSafeEqual(left, right);
};

// "sha256=" + hex HMAC over "<unix seconds>.<raw body>", the scheme both InventiveChat and our own apps use.
export const verifyBodySignature = ({ secret, timestamp, signature, rawBody, nowSeconds = Date.now() / 1000 }: { secret: string | null | undefined; timestamp: string | undefined; signature: string | undefined; rawBody: string; nowSeconds?: number }) => {
  if (!secret || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  return sameText(signBody(secret, timestamp, rawBody), signature);
};
