import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const secret = () => {
  const value = process.env.CHAT_SECRET;
  if (!value || value.length < 32) throw new Error('CHAT_SECRET must be set (at least 32 characters).');
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

// One key per workspace, derived from the server secret, so a leaked record from one client is useless in another.
const workspaceKey = (purpose: string) => {
  const workspaceId = workspaceIdFromToken(process.env.TWENTY_APP_APPLICATION_ACCESS_TOKEN) ?? workspaceIdFromToken(process.env.TWENTY_APP_ACCESS_TOKEN);
  if (!workspaceId) throw new Error('The workspace of this request is unknown, so chat data cannot be read or written.');
  const base = createHmac('sha256', secret()).update(`workspace:${workspaceId}`).digest();
  return createHmac('sha256', base).update(purpose).digest();
};

const mac = (value: string) => createHmac('sha256', workspaceKey('chat-seals')).update(value).digest('base64url').slice(0, 32);

// Chat records hold these keyed hashes instead of member ids: anyone can read and write the records through the API,
// but without the key they can neither tell who is who nor make a row the app accepts.
export const memberKey = (memberId: string) => mac(`member:${memberId}`);

export const membershipSeal = (channelId: string, memberId: string) => mac(`membership:${channelId}:${memberId}`);

export type SealedChannel = { id: string; kind: string; visibility: string; directKey: string | null; createdByMemberId: string | null };

export const channelSeal = (channel: SealedChannel) => mac(`channel:${channel.id}:${channel.kind}:${channel.visibility}:${channel.directKey ?? ''}:${channel.createdByMemberId ?? ''}`);

export const channelNameKey = (name: string) => mac(`channel-name:${name}`);

export const directConversationKey = (first: string, second: string) => mac(`direct:${[first, second].sort().join(':')}`);

export const sealMatches = (expected: string, given: string | null | undefined) => {
  const left = Buffer.from(expected);
  const right = Buffer.from(given ?? '');
  return left.length === right.length && timingSafeEqual(left, right);
};

// The associated data names where the text belongs (channel, author, message id), so ciphertext copied into another
// record no longer decrypts.
export const encryptText = (text: string, context: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', workspaceKey('chat-messages'), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `v1.${iv.toString('base64url')}.${encrypted.toString('base64url')}`;
};

export const decryptText = (stored: string | null, context: string) => {
  const [version, iv, payload] = (stored ?? '').split('.');
  if (version !== 'v1' || !iv || !payload) return null;
  try {
    const data = Buffer.from(payload, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', workspaceKey('chat-messages'), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(data.subarray(data.length - 16));
    return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
};
