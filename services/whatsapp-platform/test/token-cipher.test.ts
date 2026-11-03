import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { decryptToken, encryptToken, loadTokenKeyFromEnvironment, type TokenKey } from '../src/crypto/token-cipher.ts';

const key: TokenKey = { id: 'k1', key: randomBytes(32) };

describe('token cipher', () => {
  it('round-trips a token for the same tenant', () => {
    const encrypted = encryptToken(key, 'tnt_aaaaaaaa', 'EAAG-secret');
    assert.equal(decryptToken([key], 'tnt_aaaaaaaa', encrypted), 'EAAG-secret');
    assert.equal(encrypted.ciphertext.includes(Buffer.from('EAAG-secret')), false);
  });

  it('fails when the ciphertext is moved to another tenant', () => {
    const encrypted = encryptToken(key, 'tnt_aaaaaaaa', 'EAAG-secret');
    assert.throws(() => decryptToken([key], 'tnt_bbbbbbbb', encrypted));
  });

  it('fails on tampering', () => {
    const encrypted = encryptToken(key, 'tnt_aaaaaaaa', 'EAAG-secret');
    const tampered = Buffer.from(encrypted.ciphertext);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    assert.throws(() => decryptToken([key], 'tnt_aaaaaaaa', { ...encrypted, ciphertext: tampered }));
  });

  it('fails with an unknown key id', () => {
    const encrypted = encryptToken(key, 'tnt_aaaaaaaa', 'EAAG-secret');
    assert.throws(() => decryptToken([{ id: 'k2', key: randomBytes(32) }], 'tnt_aaaaaaaa', encrypted));
  });

  it('rejects a key of the wrong length', () => {
    assert.throws(() =>
      loadTokenKeyFromEnvironment({ TOKEN_ENCRYPTION_KEY_ID: 'k1', TOKEN_ENCRYPTION_KEY: randomBytes(16).toString('base64') }),
    );
  });
});
