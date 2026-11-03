import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type TokenKey = {
  id: string;
  key: Buffer;
};

export type EncryptedToken = {
  keyId: string;
  ciphertext: Buffer;
};

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export const loadTokenKeyFromEnvironment = (environment: NodeJS.ProcessEnv): TokenKey => {
  const id = environment.TOKEN_ENCRYPTION_KEY_ID;
  const encoded = environment.TOKEN_ENCRYPTION_KEY;
  if (!id || !encoded) {
    throw new Error('TOKEN_ENCRYPTION_KEY_ID and TOKEN_ENCRYPTION_KEY must be set');
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded');
  }
  return { id, key };
};

// The tenant id is bound as AAD so a ciphertext copied to another tenant's row fails to decrypt.
export const encryptToken = (key: TokenKey, tenantId: string, plaintext: string): EncryptedToken => {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key.key, iv);
  cipher.setAAD(Buffer.from(tenantId, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { keyId: key.id, ciphertext: Buffer.concat([iv, cipher.getAuthTag(), body]) };
};

export const decryptToken = (keys: readonly TokenKey[], tenantId: string, encrypted: EncryptedToken): string => {
  const key = keys.find((candidate) => candidate.id === encrypted.keyId);
  if (!key) {
    throw new Error(`no token key loaded for key id ${encrypted.keyId}`);
  }
  const iv = encrypted.ciphertext.subarray(0, IV_LENGTH);
  const tag = encrypted.ciphertext.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const body = encrypted.ciphertext.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key.key, iv);
  decipher.setAAD(Buffer.from(tenantId, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
};
