import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type BusinessProfile } from 'src/lib/compliance';
import { buildEmail, channelsFor, escapeHtml, requestedChannels, type SendableDocument, toE164, verifyWhatsAppSignature } from 'src/lib/delivery';
import { resolveGatewayUrl } from 'src/lib/delivery';

const profile = { id: 'p', tradingName: 'Bright Electrical', legalName: 'Bright Electrical Ltd', emailMessage: '' } as BusinessProfile;

const invoice: SendableDocument = {
  kind: 'invoice',
  id: 'i',
  type: 'INVOICE',
  number: 'INV-0007',
  status: 'ISSUED',
  totalPence: 123456,
  amountDuePence: 123456,
  issueDate: '2026-11-03',
  dueDate: '2026-12-03',
  validUntil: null,
  pdf: null,
  recipient: {
    id: 'r',
    name: { firstName: 'Sam', lastName: 'Patel' },
    emails: { primaryEmail: 'sam@example.co.uk' },
    phones: { primaryPhoneNumber: '07700 900123', primaryPhoneCallingCode: '+44' },
    preferredChannel: 'EMAIL',
    whatsappOptIn: true,
  },
  paymentUrl: null,
};

describe('document emails', () => {
  it('names the business, number, amount and due date', () => {
    const email = buildEmail(invoice, profile, { reminder: false });
    expect(email.subject).toBe('Invoice INV-0007 from Bright Electrical');
    expect(email.text).toContain('Hello Sam,');
    expect(email.text).toContain('invoice INV-0007 for £1,234.56, due on 3 December 2026');
  });

  it('writes an overdue reminder and the business message, escaping HTML', () => {
    const email = buildEmail(invoice, { ...profile, emailMessage: 'Pay by BACS <thanks>' }, { reminder: true });
    expect(email.subject).toBe('Reminder: invoice INV-0007 from Bright Electrical is overdue');
    expect(email.text).toContain('has not been paid yet');
    expect(email.html).toContain('Pay by BACS &lt;thanks&gt;');
  });

  it('asks only for what is still owed after a part payment or credit note', () => {
    const partPaid = { ...invoice, status: 'PART_PAID', amountDuePence: 23456, paymentUrl: 'https://buy.stripe.com/test_1' };
    const reminder = buildEmail(partPaid, profile, { reminder: true });
    expect(reminder.text).toContain('£234.56 of invoice INV-0007 for £1,234.56');
    expect(reminder.html).toContain('Pay £234.56 now');
    expect(buildEmail(partPaid, profile, { reminder: false, paymentLink: true }).text).toContain('pay invoice INV-0007 (£234.56) securely online');
    expect(buildEmail(invoice, profile, { reminder: true }).text).toContain('that invoice INV-0007 for £1,234.56');
  });

  it('escapes quotes so a value cannot leave an HTML attribute', () => {
    expect(escapeHtml(`"><img src=x onerror='alert(1)'>`)).toBe('&quot;&gt;&lt;img src=x onerror=&#39;alert(1)&#39;&gt;');
  });

  it('gives a quote its validity date', () => {
    const email = buildEmail({ ...invoice, type: 'QUOTE', number: 'QUO-0002', dueDate: null, validUntil: '2026-12-01' }, profile, { reminder: false });
    expect(email.subject).toBe('Quote QUO-0002 from Bright Electrical');
    expect(email.text).toContain('valid until 1 December 2026');
  });
});

describe('WhatsApp numbers', () => {
  it('turns a UK mobile into E.164', () => {
    expect(toE164({ primaryPhoneNumber: '07700 900123', primaryPhoneCallingCode: '+44' })).toBe('+447700900123');
    expect(toE164({ primaryPhoneNumber: '7700900123', primaryPhoneCallingCode: '' })).toBe('+447700900123');
    expect(toE164({ primaryPhoneNumber: '+353 85 123 4567', primaryPhoneCallingCode: '+44' })).toBe('+353851234567');
    expect(toE164({ primaryPhoneNumber: '', primaryPhoneCallingCode: '+44' })).toBeNull();
  });

  it("follows the contact's preferred channel", () => {
    expect(channelsFor(invoice.recipient)).toEqual(['EMAIL']);
    expect(channelsFor({ ...invoice.recipient!, preferredChannel: 'EMAIL_AND_WHATSAPP' })).toEqual(['EMAIL', 'WHATSAPP']);
    expect(channelsFor(null)).toEqual(['EMAIL']);
  });
});

describe('requested channels', () => {
  it("uses the contact's preferred channels when none are given", () => {
    expect(requestedChannels(undefined)).toBeUndefined();
    expect(requestedChannels(null)).toBeUndefined();
    expect(requestedChannels([])).toBeUndefined();
    expect(requestedChannels('')).toBeUndefined();
  });

  it('sends on each channel at most once', () => {
    expect(requestedChannels(Array.from({ length: 500 }, () => 'EMAIL'))).toEqual(['EMAIL']);
    expect(requestedChannels(['WHATSAPP', 'EMAIL', 'WHATSAPP'])).toEqual(['EMAIL', 'WHATSAPP']);
  });

  it('refuses anything other than EMAIL and WHATSAPP', () => {
    expect(requestedChannels(['EMAIL', 'SMS'])).toBeNull();
    expect(requestedChannels(['email'])).toBeNull();
    expect(requestedChannels('EMAIL')).toBeNull();
    expect(requestedChannels([{ channel: 'EMAIL' }])).toBeNull();
  });
});

describe('WhatsApp callback signatures', () => {
  afterEach(() => vi.unstubAllEnvs());

  const sign = (body: string, timestamp: string) => `sha256=${createHmac('sha256', 'shared-secret').update(`${timestamp}.${body}`).digest('hex')}`;

  it('accepts a fresh, correctly signed body and rejects anything else', () => {
    vi.stubEnv('WHATSAPP_GATEWAY_SECRET', 'shared-secret');
    const body = '{"deliveryId":"d","status":"delivered"}';
    const now = Math.floor(Date.now() / 1000).toString();
    expect(verifyWhatsAppSignature(body, now, sign(body, now))).toBe(true);
    expect(verifyWhatsAppSignature(body.replace('delivered', 'read'), now, sign(body, now))).toBe(false);
    const old = (Number(now) - 600).toString();
    expect(verifyWhatsAppSignature(body, old, sign(body, old))).toBe(false);
    expect(verifyWhatsAppSignature(body, now, undefined)).toBe(false);
  });

  it('rejects everything when no secret is configured', () => {
    vi.stubEnv('WHATSAPP_GATEWAY_SECRET', '');
    const now = Math.floor(Date.now() / 1000).toString();
    expect(verifyWhatsAppSignature('{}', now, sign('{}', now))).toBe(false);
  });
});

describe('WhatsApp gateway address', () => {
  it('sends a path to the WhatsApp app of this same workspace, and keeps a full address as it is', () => {
    expect(resolveGatewayUrl('/s/whatsapp/gateway', 'https://acme.crm.example.com/s')).toBe('https://acme.crm.example.com/s/whatsapp/gateway');
    expect(resolveGatewayUrl('/s/whatsapp/gateway', 'https://glow.crm.example.com/s')).toBe('https://glow.crm.example.com/s/whatsapp/gateway');
    expect(resolveGatewayUrl('https://chat.example.com/hand-off', 'https://acme.crm.example.com/s')).toBe('https://chat.example.com/hand-off');
  });
});
