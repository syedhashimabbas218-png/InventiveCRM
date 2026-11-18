import { describe, expect, it } from 'vitest';

import { chooseNumber, correlationId, describeError, envelope, findTemplate, InventiveChatError, type InventiveChatTemplate, namedParameters, readError } from 'src/lib/inventivechat';
import { canMoveStatus, isWindowOpen, statusesThatCanMoveTo, templateValues, windowExpiresAt } from 'src/lib/rules';
import { nextIdempotencyKey, retryAtFor, waitingForOf } from 'src/lib/sending';

const ID = '11111111-1111-4111-8111-111111111111';

describe('statuses only move forward', () => {
  it('moves sent, delivered, read in order and ignores going back', () => {
    expect(canMoveStatus(null, 'QUEUED')).toBe(true);
    expect(canMoveStatus('QUEUED', 'SENT')).toBe(true);
    expect(canMoveStatus('SENT', 'DELIVERED')).toBe(true);
    expect(canMoveStatus('QUEUED', 'READ')).toBe(true);
    expect(canMoveStatus('READ', 'DELIVERED')).toBe(false);
    expect(canMoveStatus('DELIVERED', 'SENT')).toBe(false);
    expect(canMoveStatus('SENT', 'SENT')).toBe(false);
  });

  it('lets a failure follow only an undelivered message, and a delivery report win over a failure', () => {
    expect(canMoveStatus('SENT', 'FAILED')).toBe(true);
    expect(canMoveStatus('DELIVERED', 'FAILED')).toBe(false);
    expect(canMoveStatus('READ', 'FAILED')).toBe(false);
    expect(canMoveStatus('FAILED', 'DELIVERED')).toBe(true);
    expect(canMoveStatus('FAILED', 'SENT')).toBe(false);
    expect(statusesThatCanMoveTo('DELIVERED')).toEqual(['QUEUED', 'SENT', 'FAILED']);
    expect(statusesThatCanMoveTo('FAILED')).toEqual(['QUEUED', 'SENT']);
  });
});

describe('the 24-hour window', () => {
  it('opens for a day after the customer writes', () => {
    const expires = windowExpiresAt('2026-11-18T10:00:00.000Z');
    expect(expires).toBe('2026-11-19T10:00:00.000Z');
    expect(isWindowOpen(expires, Date.parse('2026-11-19T09:59:00.000Z'))).toBe(true);
    expect(isWindowOpen(expires, Date.parse('2026-11-19T10:01:00.000Z'))).toBe(false);
    expect(isWindowOpen(null)).toBe(false);
  });
});

describe('requests to InventiveChat', () => {
  it('wrap every POST in the envelope it checks', () => {
    const sent = envelope({ key: 'wa_x', tenantId: 'ten_1' }, { a: 1 }, 'crm_key\n_1', '0b7c1f0e-1111-4111-8111-111111111111');
    expect(sent).toMatchObject({ tenant_id: 'ten_1', actor: { type: 'system' }, idempotency_key: 'crm_key_1', payload: { a: 1 } });
    expect(sent.correlation_id).toBe('cor_0b7c1f0e111141118111111111111111');
    expect(sent.occurred_at).toMatch(/Z$/);
    expect(correlationId('ab')).toMatch(/^cor_[A-Za-z0-9]{8,64}$/);
    expect(correlationId()).toMatch(/^cor_[A-Za-z0-9]{8,64}$/);
  });

  it('pick the active number, and only by default when there is exactly one', () => {
    const one = { id: 'wac_1', phone: '+44 7700 900000', verifiedName: 'Acme', active: true };
    const two = { ...one, id: 'wac_2' };
    expect(chooseNumber([one, { ...two, active: false }], null)?.id).toBe('wac_1');
    expect(chooseNumber([one, two], null)).toBeNull();
    expect(chooseNumber([one, two], 'wac_2')?.id).toBe('wac_2');
  });

  it('fill templates by parameter name, from names or in the template order', () => {
    const templates: InventiveChatTemplate[] = [
      { name: 'offer', language: 'en_GB', category: 'marketing', body: 'Hi {{first_name}}', parameters: ['first_name', 'discount'], quickReplies: [], status: 'approved' },
      { name: 'offer', language: 'de_DE', category: 'marketing', body: 'Hallo', parameters: ['first_name', 'discount'], quickReplies: [], status: 'approved' },
      { name: 'draft', language: 'en_GB', category: 'utility', body: '', parameters: [], quickReplies: [], status: 'pending' },
    ];
    expect(findTemplate(templates, 'offer', ['de_DE'])?.language).toBe('de_DE');
    expect(findTemplate(templates, 'offer', [null, 'fr_FR'])?.language).toBe('en_GB');
    expect(findTemplate(templates, 'draft', ['en_GB'])).toBeNull();
    const [offer] = templates as [InventiveChatTemplate];
    expect(namedParameters(offer, ['Ann', '20%'])).toEqual({ parameters: { first_name: 'Ann', discount: '20%' }, missing: [] });
    expect(namedParameters(offer, { first_name: 'Ann', other: 'x' })).toEqual({ parameters: { first_name: 'Ann' }, missing: ['discount'] });
    expect(templateValues({ first_name: 'Ann', 'bad name': 'x', count: 3, nested: {} })).toEqual({ first_name: 'Ann', count: '3' });
  });
});

describe('InventiveChat refusals', () => {
  it('tells short waits, long waits and failures apart', () => {
    const busy = readError(429, { error: 'rate_limited' }, '2');
    expect(busy.retryable).toBe(true);
    expect(busy.retryAfterSeconds).toBe(2);
    expect(readError(429, { reason: 'too_many_concurrent_sends' }, null).retryable).toBe(true);
    const meta = readError(429, { reason: 'meta_rate_limited', meta_error: { code: '131056', title: 'Pair rate limit hit' }, retry_after_seconds: 600 }, null);
    expect(meta).toMatchObject({ retryable: false, later: true, retryAfterSeconds: 600, metaError: { code: '131056', title: 'Pair rate limit hit' } });
    const rejected = readError(502, { reason: 'provider_rejected', meta_error: { code: '131026', title: 'Message undeliverable' } }, null);
    expect(rejected.retryable).toBe(false);
    expect(describeError(rejected)).toBe('WhatsApp refused the message: Message undeliverable (Meta error 131026).');
    expect(new InventiveChatError('down', 503, 'http_503').retryable).toBe(true);
    expect(new InventiveChatError('timeout', 0, 'unreachable').retryable).toBe(true);
  });

  it('explains every refusal plainly', () => {
    expect(describeError(readError(423, { reason: 'human_active', paused_until: null, retry_after_seconds: null }, null))).toMatch(/hand the conversation back/);
    expect(describeError(readError(423, { reason: 'human_active', paused_until: '2026-11-18T14:00:00Z', retry_after_seconds: 3600 }, null))).toMatch(/until 18 Nov 2026/);
    expect(describeError(readError(422, { reason: 'out_of_scope', allowed_topics: ['bookings'], action: 'handoff' }, null))).toBe('InventiveChat does not allow automated replies on this topic. Allowed topics: bookings.');
    expect(describeError(readError(422, { reason: 'out_of_scope', allowed_topics: [] }, null))).toMatch(/Allowed topics: none yet/);
    expect(describeError(readError(409, { reason: 'awaiting_approval' }, null))).toMatch(/approval/);
    expect(describeError(readError(422, { reason: 'invalid_payload', errors: ['template.parameters.amount is required'] }, null))).toBe('InventiveChat refused the request: template.parameters.amount is required');
    expect(describeError(readError(400, { error: 'invalid_envelope', details: ['correlation_id is invalid'] }, null))).toBe('InventiveChat refused the request: correlation_id is invalid');
    expect(describeError(readError(401, { error: 'unauthenticated' }, null))).toMatch(/reconnect/);
    expect(describeError(readError(403, { error: 'operation_not_allowed_for_actor' }, null))).toMatch(/not allowed to do this \(operation_not_allowed_for_actor\)/);
    expect(describeError(readError(422, { reason: 'whatsapp_account_id_required' }, null))).toMatch(/several WhatsApp numbers/);
  });

  it('waits as long as InventiveChat asks, or for the teammate to hand back', () => {
    const now = Date.parse('2026-11-18T10:00:00.000Z');
    const created = '2026-11-18T09:00:00.000Z';
    expect(retryAtFor(readError(429, { reason: 'meta_rate_limited', retry_after_seconds: 600 }, null), created, now)).toBe('2026-11-18T10:10:00.000Z');
    expect(retryAtFor(readError(423, { reason: 'human_active', paused_until: '2026-11-18T14:00:00Z', retry_after_seconds: 14400 }, null), created, now)).toBe('2026-11-18T14:00:00.000Z');
    const handBack = readError(423, { reason: 'human_active', paused_until: null, retry_after_seconds: null }, null);
    expect(handBack.waitsForHandBack).toBe(true);
    expect(retryAtFor(handBack, created, now)).toBe('2026-11-19T09:00:00.000Z');
    expect(waitingForOf(handBack)).toBe('person');
    expect(retryAtFor(readError(429, { error: 'rate_limited' }, null), created, now)).toBe('2026-11-18T10:02:00.000Z');
  });

  it('keeps the idempotency key while the outcome is unknown and moves on after a definite failure', () => {
    expect(nextIdempotencyKey({ id: ID, status: 'QUEUED', idempotencyKey: null })).toBe('crm_11111111111141118111111111111111_1');
    expect(nextIdempotencyKey({ id: ID, status: 'QUEUED', idempotencyKey: 'crm_11111111111141118111111111111111_1' })).toBe('crm_11111111111141118111111111111111_1');
    expect(nextIdempotencyKey({ id: ID, status: 'FAILED', idempotencyKey: 'crm_11111111111141118111111111111111_1' })).toBe('crm_11111111111141118111111111111111_2');
  });
});
