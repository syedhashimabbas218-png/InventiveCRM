import { describe, expect, it } from 'vitest';

import { connectPage, isTrustedCallback, providerFromConnectionName } from 'src/lib/payment-connect';
import { formEncode, outstandingPence } from 'src/lib/payments';

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
});
