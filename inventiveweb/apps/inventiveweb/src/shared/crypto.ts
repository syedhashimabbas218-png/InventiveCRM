import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (raw) {
    const buf = Buffer.from(raw, 'hex');
    if (buf.length === 32) return buf;
  }
  if (process.env.NODE_ENV === 'test' || process.env.TWENTY_TEST_ENV) {
    return createHash('sha256').update('test-only-encryption-key').digest();
  }
  throw new Error('ENCRYPTION_KEY must be a 32-byte hex string.');
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decrypt(ciphertext: string): string {
  const input = Buffer.from(ciphertext, 'base64');
  if (input.length < 32) throw new Error('Invalid encrypted value.');
  const iv = input.subarray(0, 16);
  const authTag = input.subarray(16, 32);
  const encrypted = input.subarray(32);
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
