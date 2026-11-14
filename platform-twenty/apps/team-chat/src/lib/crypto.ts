import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

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
const messageKey = () => {
  const workspaceId = workspaceIdFromToken(process.env.TWENTY_APP_APPLICATION_ACCESS_TOKEN) ?? workspaceIdFromToken(process.env.TWENTY_APP_ACCESS_TOKEN);
  if (!workspaceId) throw new Error('The workspace of this request is unknown, so messages cannot be read or written.');
  const workspaceKey = createHmac('sha256', secret()).update(`workspace:${workspaceId}`).digest();
  return createHmac('sha256', workspaceKey).update('chat-messages').digest();
};

// The channel id is bound in as associated data, so a message copied into another channel no longer decrypts.
export const encryptMessage = (text: string, channelId: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', messageKey(), iv);
  cipher.setAAD(Buffer.from(channelId));
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `v1.${iv.toString('base64url')}.${encrypted.toString('base64url')}`;
};

export const decryptMessage = (stored: string | null, channelId: string) => {
  const [version, iv, payload] = (stored ?? '').split('.');
  if (version !== 'v1' || !iv || !payload) return null;
  try {
    const data = Buffer.from(payload, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', messageKey(), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(channelId));
    decipher.setAuthTag(data.subarray(data.length - 16));
    return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
};
