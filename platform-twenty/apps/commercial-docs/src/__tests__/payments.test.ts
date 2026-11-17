import { afterEach, describe, expect, it, vi } from 'vitest';

import { connectPage, isTrustedCallback, providerFromConnectionName } from 'src/lib/payment-connect';
import { formEncode, isPaymentPageUrl, outstandingPence } from 'src/lib/payments';

const micros = (pence: number) => ({ amountMicros: pence * 10_000 });

describe('payments', () => {
  it('encodes nested Stripe parameters with brackets', () => {
    const encoded = formEncode({ line_items: { 0: { price_data: { currency: 'gbp', unit_amount: 1250 } } }, restrictions: { completed_sessions: { limit: 1 } }, skip: undefined });
    expect(encoded).toContain(`${encodeURIComponent('line_items[0][price_data][unit_amount]')}=1250`);
    expect(encoded).toContain(`${encodeURIComponent('restrictions[completed_sessions][limit]')}=1`);
    expect(encoded.some((pair) => pair.startsWith('skip'))).toBe(false);
  });

  it('charges only what is still owed', () => {
    expect(outstandingPence({ total: micros(12_000), amountPaid: micros(2_000) })).toBe(10_000);
    expect(outstandingPence({ total: micros(12_000), amountPaid: micros(15_000) })).toBe(0);
    expect(outstandingPence({ total: micros(5_000), amountPaid: null })).toBe(5_000);
  });

  it('takes issued credit notes off what is owed, but not drafts or voided ones', () => {
    const creditNote = (pence: number, overrides: { status?: string; issuedAt?: string | null; kind?: string } = {}) => ({
      node: { kind: 'CREDIT_NOTE', status: 'ISSUED', issuedAt: '2026-11-10T09:00:00.000Z', total: micros(pence), ...overrides },
    });
    const creditNotes = { edges: [creditNote(3_000), creditNote(1_000, { issuedAt: null, status: 'DRAFT' }), creditNote(500, { status: 'VOID' })] };
    expect(outstandingPence({ total: micros(12_000), amountPaid: micros(2_000), creditNotes })).toBe(7_000);
    expect(outstandingPence({ total: micros(12_000), amountPaid: micros(10_000), creditNotes })).toBe(0);
    expect(outstandingPence({ total: micros(12_000), amountPaid: null, creditNotes: null })).toBe(12_000);
  });

  it('maps connection names to providers', () => {
    expect(providerFromConnectionName('stripe-account')).toBe('STRIPE');
    expect(providerFromConnectionName('revolut-account')).toBe('REVOLUT');
    expect(providerFromConnectionName('google-calendar')).toBeNull();
  });

  it("posts keys only to Twenty's own callback", () => {
    const server = 'https://crm.inventiveweb.studio';
    expect(isTrustedCallback(`${server}/auth/apps/custom/callback?state=abc`, server)).toBe(true);
    expect(isTrustedCallback('https://evil.example/auth/apps/custom/callback?state=abc', server)).toBe(false);
    expect(isTrustedCallback(`${server}/auth/apps/custom/callback`, server)).toBe(false);
    expect(isTrustedCallback(`${server}/somewhere-else?state=abc`, server)).toBe(false);
    expect(isTrustedCallback('javascript:alert(1)', server)).toBe(false);
  });

  it('escapes the callback in the connect form', () => {
    const page = connectPage('STRIPE', 'https://crm.example/auth/apps/custom/callback?state="><script>x</script>');
    expect(page).not.toContain('<script>x</script>');
    expect(page).toContain('name="secretKey"');
    expect(page).toContain('type="password"');
  });

  describe('pay-now link hosts', () => {
    afterEach(() => vi.unstubAllEnvs());

    it("accepts only Stripe and Revolut payment pages over https", () => {
      expect(isPaymentPageUrl('https://buy.stripe.com/test_8wM5kE', false)).toBe(true);
      expect(isPaymentPageUrl('https://checkout.stripe.com/c/pay/cs_live_1', false)).toBe(true);
      expect(isPaymentPageUrl('https://checkout.revolut.com/payment-link/abc', false)).toBe(true);
      expect(isPaymentPageUrl('https://sandbox-checkout.revolut.com/payment-link/abc', false)).toBe(true);
      expect(isPaymentPageUrl('http://buy.stripe.com/x', false)).toBe(false);
      expect(isPaymentPageUrl('https://buy.stripe.com.evil.example/x', false)).toBe(false);
      expect(isPaymentPageUrl('https://evil.example/?u=https://buy.stripe.com/x', false)).toBe(false);
      expect(isPaymentPageUrl('https://user@buy.stripe.com/x', false)).toBe(false);
      expect(isPaymentPageUrl('https://buy.stripe.com:8443/x', false)).toBe(false);
      expect(isPaymentPageUrl('javascript:alert(1)', false)).toBe(false);
      expect(isPaymentPageUrl('', false)).toBe(false);
      expect(isPaymentPageUrl(null, false)).toBe(false);
    });

    it('accepts the test double pages only when a payment double is configured', () => {
      vi.stubEnv('STRIPE_API_URL', '');
      vi.stubEnv('REVOLUT_API_URL', '');
      expect(isPaymentPageUrl('https://buy.stripe.test/plink_1')).toBe(false);
      vi.stubEnv('STRIPE_API_URL', 'http://127.0.0.1:8096');
      expect(isPaymentPageUrl('https://buy.stripe.test/plink_1')).toBe(true);
      expect(isPaymentPageUrl('https://checkout.revolut.test/payment-link/1')).toBe(true);
    });
  });
});
