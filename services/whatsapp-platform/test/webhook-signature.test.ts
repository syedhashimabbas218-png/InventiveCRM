import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isValidWebhookSignature, signWebhookBody } from '../src/messaging/signature.ts';

const SECRET = 'app-secret';

describe('X-Hub-Signature-256', () => {
  const body = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');

  it('accepts a correct signature', () => {
    assert.equal(isValidWebhookSignature(SECRET, body, signWebhookBody(SECRET, body)), true);
  });

  it('rejects a missing, malformed or wrong signature', () => {
    for (const header of [undefined, '', 'sha256=', 'sha1=abc', `sha256=${'0'.repeat(64)}`, signWebhookBody('other', body)]) {
      assert.equal(isValidWebhookSignature(SECRET, body, header), false, String(header));
    }
  });

  it('rejects uppercase hex because Meta sends lowercase', () => {
    assert.equal(isValidWebhookSignature(SECRET, body, signWebhookBody(SECRET, body).toUpperCase()), false);
  });

  it('rejects when the secret is empty', () => {
    assert.equal(isValidWebhookSignature('', body, signWebhookBody('', body)), false);
  });

  it('signs the raw escaped bytes, not re-serialised JSON', () => {
    const escaped = Buffer.from('{"text":"\\u00e4\\u00f6\\u00e5"}');
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(escaped.toString())));
    const header = signWebhookBody(SECRET, escaped);
    assert.equal(isValidWebhookSignature(SECRET, escaped, header), true);
    assert.equal(isValidWebhookSignature(SECRET, reserialised, header), false);
  });

  it('rejects a body changed after signing', () => {
    const header = signWebhookBody(SECRET, body);
    assert.equal(isValidWebhookSignature(SECRET, Buffer.from(`${body.toString()} `), header), false);
  });
});
