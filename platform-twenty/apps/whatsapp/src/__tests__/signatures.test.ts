import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { keyFingerprint, openText, sealText, signBody, verifyBodySignature } from 'src/lib/crypto';
import { verifyWebhook } from 'src/lib/inventivechat';
import { buildPublishRequest, mintRealtimeToken } from 'src/lib/realtime';

const SECRET = 'whsec_test_secret_value';
const BODY = JSON.stringify({ tenant_id: 'ten_1', payload: { type: 'message.received', data: {} } });
const NOW = 1_800_000_000;
const tokenFor = (workspaceId: string) => `x.${Buffer.from(JSON.stringify({ workspaceId })).toString('base64url')}.y`;

const headersFor = (body: string, { secret = SECRET, timestamp = NOW } = {}) => ({
  'x-signature-timestamp': String(timestamp),
  'x-signature-256': `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`,
});

describe('webhook signatures', () => {
  it('accepts a correct signature within five minutes', () => {
    expect(verifyWebhook(SECRET, BODY, headersFor(BODY), NOW)).toBe(true);
    expect(verifyWebhook(SECRET, BODY, headersFor(BODY, { timestamp: NOW - 299 }), NOW)).toBe(true);
  });

  it('refuses a wrong secret, a stale or future timestamp, an altered body and missing headers', () => {
    expect(verifyWebhook(SECRET, BODY, headersFor(BODY, { secret: 'other' }), NOW)).toBe(false);
    expect(verifyWebhook(SECRET, BODY, headersFor(BODY, { timestamp: NOW - 301 }), NOW)).toBe(false);
    expect(verifyWebhook(SECRET, BODY, headersFor(BODY, { timestamp: NOW + 301 }), NOW)).toBe(false);
    expect(verifyWebhook(SECRET, `${BODY} `, headersFor(BODY), NOW)).toBe(false);
    expect(verifyWebhook(SECRET, BODY, {}, NOW)).toBe(false);
    expect(verifyWebhook(null, BODY, headersFor(BODY), NOW)).toBe(false);
    expect(verifyWebhook(SECRET, BODY, { ...headersFor(BODY), 'x-signature-timestamp': 'yesterday' }, NOW)).toBe(false);
  });

  it('signs gateway callbacks the way WHATSAPP_HANDOFF.md section 2 describes', () => {
    const body = '{"deliveryId":"d1","status":"delivered"}';
    const expected = `sha256=${createHmac('sha256', 'gateway').update(`123.${body}`).digest('hex')}`;
    expect(signBody('gateway', '123', body)).toBe(expected);
    expect(verifyBodySignature({ secret: 'gateway', timestamp: '123', signature: expected, rawBody: body, nowSeconds: 123 })).toBe(true);
  });
});

describe('sealed webhook secret', () => {
  afterEach(() => {
    delete process.env.WHATSAPP_APP_SECRET;
    delete process.env.TWENTY_APP_ACCESS_TOKEN;
  });

  it('opens only in the same workspace and for the same purpose', () => {
    process.env.WHATSAPP_APP_SECRET = 'a'.repeat(40);
    process.env.TWENTY_APP_ACCESS_TOKEN = tokenFor('workspace-a');
    const sealed = sealText(SECRET, 'inventivechat-webhook:ten_1:sub_1');
    expect(sealed).not.toContain(SECRET);
    expect(openText(sealed, 'inventivechat-webhook:ten_1:sub_1')).toBe(SECRET);
    expect(openText(sealed, 'inventivechat-webhook:ten_1:sub_2')).toBeNull();
    process.env.TWENTY_APP_ACCESS_TOKEN = tokenFor('workspace-b');
    expect(openText(sealed, 'inventivechat-webhook:ten_1:sub_1')).toBeNull();
  });

  it('refuses to work without a long secret', () => {
    process.env.WHATSAPP_APP_SECRET = 'short';
    process.env.TWENTY_APP_ACCESS_TOKEN = tokenFor('workspace-a');
    expect(() => sealText('x', 'y')).toThrow(/WHATSAPP_APP_SECRET/);
  });

  it('fingerprints keys without revealing them', () => {
    expect(keyFingerprint('wa_secret_key_123')).toMatch(/^[0-9a-f]{16}$/);
    expect(keyFingerprint('wa_secret_key_123')).not.toBe(keyFingerprint('wa_secret_key_124'));
  });
});

describe('realtime hub', () => {
  it('signs publishes over the timestamp and the raw body', () => {
    const { body, headers } = buildPublishRequest({ workspace: 'w1', events: [{ kind: 'message', ids: ['m1'] }], secret: 'r'.repeat(32), nowSeconds: 100 });
    expect(JSON.parse(body)).toEqual({ workspace: 'w1', topic: 'whatsapp', events: [{ kind: 'message', ids: ['m1'] }] });
    expect(headers['X-Realtime-Timestamp']).toBe('100');
    expect(headers['X-Realtime-Signature']).toBe(`sha256=${createHmac('sha256', 'r'.repeat(32)).update(`100.${body}`).digest('hex')}`);
  });

  it('mints tokens for one member and topic that expire after an hour', () => {
    const { token, expiresAt } = mintRealtimeToken({ workspace: 'w1', member: 'm1', secret: 'r'.repeat(32), nowSeconds: 1000 });
    const [version, payload, signature] = token.split('.');
    expect(version).toBe('v1');
    expect(JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8'))).toEqual({ workspace: 'w1', member: 'm1', topics: ['whatsapp'], exp: 4600 });
    expect(signature).toBe(createHmac('sha256', 'r'.repeat(32)).update(`v1.${payload}`).digest('base64url'));
    expect(expiresAt).toBe(new Date(4600 * 1000).toISOString());
  });
});
