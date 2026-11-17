import { describe, expect, it } from 'vitest';

import { TEST_SENDS_PER_HOUR, recentTestSends } from 'src/lib/admin';
import { TwentyUnavailableError } from 'src/lib/api';
import { DEFAULT_BRAND } from 'src/lib/design';
import { addressOf, holdBackReason, isLocalPart, isTransient, paceDelay, singleSendKey } from 'src/lib/engine';
import { MOVES_FROM } from 'src/lib/events';
import { acceptedEarlier, isInvalidMessage, isQuotaReached, refusedOutright, ResendError, retryDelayMs } from 'src/lib/resend';
import { toBrandSnapshot, type ContactState } from 'src/lib/store';

const person = (overrides: Partial<ContactState> = {}): ContactState => ({
  id: 'p1',
  emails: { primaryEmail: 'Sam@Example.com' },
  phones: { primaryPhoneNumber: '07700 900111', primaryPhoneCallingCode: '+44' },
  emailMarketingConsent: true,
  whatsappMarketingConsent: true,
  ...overrides,
});

describe('what Resend answered', () => {
  it('tells a refused request from one whose outcome is unknown', () => {
    expect(refusedOutright(new ResendError('x', 429, 'rate_limit_exceeded'))).toBe(true);
    expect(refusedOutright(new ResendError('x', 429, 'daily_quota_exceeded'))).toBe(true);
    expect(refusedOutright(new ResendError('x', 401, 'restricted_api_key'))).toBe(true);
    expect(refusedOutright(new ResendError('x', 403, 'validation_error'))).toBe(true);
    expect(refusedOutright(new ResendError('x', 500, 'internal_server_error'))).toBe(false);
    expect(refusedOutright(new ResendError('x', 409, 'concurrent_idempotent_requests'))).toBe(false);
    expect(refusedOutright(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))).toBe(false);
    expect(refusedOutright(new TypeError('fetch failed'))).toBe(false);
  });

  it('reads a changed body under a used key as sent earlier, but not a request still in progress', () => {
    expect(acceptedEarlier(new ResendError('x', 409, 'invalid_idempotent_request'))).toBe(true);
    expect(acceptedEarlier(new ResendError('x', 409, 'concurrent_idempotent_requests'))).toBe(false);
    expect(acceptedEarlier(new ResendError('x', 422, 'invalid_idempotent_request'))).toBe(false);
  });

  it('only blames the message itself for 400 and 422', () => {
    expect(isInvalidMessage(new ResendError('x', 422, 'validation_error'))).toBe(true);
    expect(isInvalidMessage(new ResendError('x', 400, 'validation_error'))).toBe(true);
    expect(isInvalidMessage(new ResendError('x', 429, 'rate_limit_exceeded'))).toBe(false);
    expect(isQuotaReached(new ResendError('x', 429, 'monthly_quota_exceeded'))).toBe(true);
    expect(isQuotaReached(new ResendError('x', 429, 'rate_limit_exceeded'))).toBe(false);
  });

  it('waits for a short retry-after, but not for a plan quota or a long wait', () => {
    expect(retryDelayMs(new ResendError('x', 429, 'rate_limit_exceeded', 2))).toBe(2000);
    expect(retryDelayMs(new ResendError('x', 429, 'rate_limit_exceeded', 60))).toBeNull();
    expect(retryDelayMs(new ResendError('x', 429, 'rate_limit_exceeded'))).toBeNull();
    expect(retryDelayMs(new ResendError('x', 429, 'daily_quota_exceeded', 1))).toBeNull();
    expect(retryDelayMs(new ResendError('x', 503, '', 1))).toBeNull();
  });
});

describe('pausing instead of failing', () => {
  it('pauses while Twenty restarts or its database times out', () => {
    expect(isTransient(new TwentyUnavailableError('Twenty did not answer: fetch failed'))).toBe(true);
    expect(isTransient(new Error('GraphQL error: Query read timeout'))).toBe(true);
    expect(isTransient(new Error('GraphQL error: Connection terminated unexpectedly'))).toBe(true);
    expect(isTransient(new Error('GraphQL error: Forbidden resource'))).toBe(false);
    expect(isTransient(new Error('Query read timeout'))).toBe(false);
  });

  it('keeps retrying a request in progress elsewhere, but not a key Resend will never accept again', () => {
    expect(isTransient(new ResendError('x', 409, 'concurrent_idempotent_requests'))).toBe(true);
    expect(isTransient(new ResendError('x', 409, 'invalid_idempotent_request'))).toBe(false);
    expect(isTransient(new ResendError('x', 401, 'restricted_api_key'))).toBe(false);
  });
});

describe('single sends', () => {
  it('are keyed by recipient within their batch', () => {
    const batchKey = '3ffc98be-ef71-4758-bd1d-a35a02b50321:4f1c0a52-7d0e-4c5e-9a43-0b6f8c2d9e11';
    const key = singleSendKey(batchKey, '11111111-1111-4111-8111-111111111111');
    expect(key).toBe(`${batchKey}:11111111-1111-4111-8111-111111111111`);
    expect(singleSendKey(batchKey, '22222222-2222-4222-8222-222222222222')).not.toBe(key);
    expect(key.length).toBeLessThanOrEqual(256);
  });

  it('start at least 600 ms apart', () => {
    expect(paceDelay(0, 1_000_000)).toBe(0);
    expect(paceDelay(1_000_000, 1_000_000)).toBe(600);
    expect(paceDelay(1_000_000, 1_000_450)).toBe(150);
    expect(paceDelay(1_000_000, 1_000_900)).toBe(0);
  });
});

describe('checks right before a batch', () => {
  const notSuppressed = () => false;

  it('sends only to the address the contact still has', () => {
    expect(holdBackReason({ address: 'sam@example.com' }, person(), 'EMAIL', notSuppressed)).toBeNull();
    expect(holdBackReason({ address: 'old@example.com' }, person(), 'EMAIL', notSuppressed)).toMatch(/address changed/);
    expect(holdBackReason({ address: '+447700900111' }, person(), 'WHATSAPP', notSuppressed)).toBeNull();
    expect(holdBackReason({ address: '+447700900111' }, person({ phones: { primaryPhoneNumber: '07700 900222', primaryPhoneCallingCode: '+44' } }), 'WHATSAPP', notSuppressed)).toMatch(/address changed/);
  });

  it('puts a deleted contact, withdrawn consent and the do-not-contact list first', () => {
    expect(holdBackReason({ address: 'sam@example.com' }, undefined, 'EMAIL', notSuppressed)).toMatch(/deleted/);
    expect(holdBackReason({ address: 'old@example.com' }, person({ emailMarketingConsent: false }), 'EMAIL', notSuppressed)).toMatch(/Withdrew consent/);
    expect(holdBackReason({ address: 'sam@example.com' }, person(), 'EMAIL', (address) => address === 'sam@example.com')).toMatch(/do-not-contact/);
  });

  it('normalises an address the same way as when the audience was prepared', () => {
    expect(addressOf(person({ emails: { primaryEmail: ' Sam@Example.COM ' } }), 'EMAIL')).toBe('sam@example.com');
    expect(addressOf(person({ phones: { primaryPhoneNumber: '+44 7700 900-111', primaryPhoneCallingCode: '' } }), 'WHATSAPP')).toBe('+447700900111');
    expect(addressOf(person({ emails: null }), 'EMAIL')).toBe('');
  });
});

describe('webhook status changes', () => {
  it('never undo a bounce, complaint, unsubscribe or failure', () => {
    for (const final of ['BOUNCED', 'COMPLAINED', 'UNSUBSCRIBED', 'FAILED'] as const)
      for (const allowed of Object.values(MOVES_FROM)) expect(allowed).not.toContain(final);
  });

  it('do not let a failure report override a delivery', () => {
    expect(MOVES_FROM.FAILED).not.toContain('DELIVERED');
    expect(MOVES_FROM.BOUNCED).toContain('DELIVERED');
    expect(MOVES_FROM.DELIVERED).toEqual(['SENDING', 'SENT']);
  });

  it('never touch recipients that were not sent', () => {
    for (const allowed of Object.values(MOVES_FROM)) expect(allowed.some((status) => status === 'QUEUED' || status === 'SKIPPED')).toBe(false);
  });
});

describe('test sends', () => {
  const now = Date.parse('2026-11-17T12:00:00.000Z');

  it('count only the last hour', () => {
    const stored = ['2026-11-17T10:30:00.000Z', '2026-11-17T11:05:00.000Z', '2026-11-17T11:59:00.000Z', 'garbage'].join(' ');
    expect(recentTestSends(stored, now)).toEqual(['2026-11-17T11:05:00.000Z', '2026-11-17T11:59:00.000Z']);
    expect(recentTestSends('', now)).toEqual([]);
  });

  it('never keep more than the hourly allowance', () => {
    const stored = Array.from({ length: 15 }, (_, index) => new Date(now - (15 - index) * 60_000).toISOString()).join(' ');
    expect(recentTestSends(stored, now)).toHaveLength(TEST_SENDS_PER_HOUR);
  });

  it('need a valid sending address', () => {
    expect(isLocalPart('news')).toBe(true);
    expect(isLocalPart('first.last+promo')).toBe(true);
    expect(isLocalPart('news@acme')).toBe(false);
    expect(isLocalPart('')).toBe(false);
  });
});

describe('brand kit kept on a campaign', () => {
  it('reads back what was stored and fills anything missing', () => {
    expect(toBrandSnapshot({ ...DEFAULT_BRAND, name: 'Acme', footerText: 'Acme Ltd' })).toEqual({ ...DEFAULT_BRAND, name: 'Acme', footerText: 'Acme Ltd' });
    expect(toBrandSnapshot({ name: 'Acme', primaryColor: 7 })).toEqual({ ...DEFAULT_BRAND, name: 'Acme' });
    expect(toBrandSnapshot(null)).toBeNull();
    expect(toBrandSnapshot('x')).toBeNull();
  });
});
