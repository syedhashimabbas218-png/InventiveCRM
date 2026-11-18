import { describe, expect, it } from 'vitest';

import { callbackBody } from 'src/lib/callbacks';
import { answerForSingle, DEFAULT_GATEWAY_TEMPLATES, effectiveMapping, type GatewayPlan, planGatewayRequest, readMapping, resolveCampaign, resolvePath, resolveSingle, splitBatch } from 'src/lib/gateway';
import { type InventiveChatTemplate } from 'src/lib/inventivechat';
import { isOwnCallbackUrl } from 'src/lib/settings';

const ORIGINS = ['https://acme.crm.inventiveweb.studio', 'https://crm.acme.co.uk'];
const template = (name: string, parameters: string[], status = 'approved', language = 'en_GB'): InventiveChatTemplate => ({ name, language, category: 'utility', body: '', parameters, quickReplies: [], status });
const TEMPLATES = [
  template('invoice_ready', ['customer_name', 'business_name', 'invoice_number', 'amount_due', 'due_date', 'invoice_link']),
  template('feedback_request', ['customer_name', 'survey_link'], 'approved', 'en_US'),
  template('quote_ready', ['customer_name'], 'pending'),
  template('spring_offer', ['first_name', 'discount'], 'approved'),
];
const options = { mapping: effectiveMapping({ 'feedback.survey': { name: 'feedback_request', language: 'en_US', parameters: { customer_name: 'recipient.firstName', survey_link: 'survey.url' } } }), origins: ORIGINS };

const invoice = {
  event: 'invoice.send',
  deliveryId: 'c78d3c20-3c61-4b14-af39-d3d30816ea87',
  business: { name: 'Acme Plumbing & Heating', replyEmail: 'accounts@acmeplumbing.test' },
  recipient: { name: 'Sam Patel', phone: '+447700900123', whatsappOptIn: true },
  document: { type: 'INVOICE', number: 'ACME-0016', amountDue: { amountPence: 11400, currency: 'GBP', formatted: '£114.00' }, dueDate: '2026-11-17', pdf: { url: 'https://acme.crm.inventiveweb.studio/file/x', filename: 'Invoice ACME-0016.pdf' } },
  statusCallbackUrl: 'https://acme.crm.inventiveweb.studio/s/whatsapp/status',
};

const single = (body: unknown) => {
  const plan = planGatewayRequest(body, options);
  if (plan.kind !== 'single') throw new Error(JSON.stringify(plan));
  return plan;
};

describe('gateway contract translation', () => {
  it('fills a template’s named parameters from the event, with the default mapping', () => {
    const plan = single(invoice);
    expect(plan).toMatchObject({ event: 'invoice.send', deliveryKey: invoice.deliveryId, phone: '+447700900123', statusCallbackUrl: invoice.statusCallbackUrl, label: 'Quotes & Invoices', mapping: DEFAULT_GATEWAY_TEMPLATES['invoice.send'] });
    expect(resolveSingle(plan, TEMPLATES, 'en_GB')).toEqual({
      template: { name: 'invoice_ready', languageCode: 'en_GB', parameters: { customer_name: 'Sam', business_name: 'Acme Plumbing & Heating', invoice_number: 'ACME-0016', amount_due: '£114.00', due_date: '2026-11-17', invoice_link: 'https://acme.crm.inventiveweb.studio/file/x' } },
    });
    const survey = single({ event: 'feedback.survey', deliveryId: 'fb-1', recipient: { name: 'Ann Lee', phone: '+447700900111' }, survey: { url: 'https://x/s/feedback/1', question: 'How did we do?' } });
    expect(survey).toMatchObject({ statusCallbackUrl: null, label: 'Feedback' });
    expect(resolveSingle(survey, TEMPLATES, 'en_GB')).toEqual({ template: { name: 'feedback_request', languageCode: 'en_US', parameters: { customer_name: 'Ann', survey_link: 'https://x/s/feedback/1' } } });
  });

  it('explains what is missing instead of sending', () => {
    expect(resolveSingle(single({ ...invoice, event: 'quote.send' }), TEMPLATES, 'en_GB')).toEqual({ error: 'The WhatsApp template quote_ready (for quote.send) is not approved in InventiveChat.' });
    const custom = planGatewayRequest(invoice, { mapping: effectiveMapping({ 'invoice.send': { name: 'invoice_ready', parameters: { customer_name: 'recipient.name' } } }), origins: ORIGINS });
    if (custom.kind !== 'single') throw new Error('expected a plan');
    expect(resolveSingle(custom, TEMPLATES, 'en_GB')).toEqual({ error: 'The WhatsApp template invoice_ready needs business_name, invoice_number, amount_due, due_date, invoice_link, which the mapping for invoice.send does not fill. Map them in WhatsApp settings.' });
    expect(planGatewayRequest({ ...invoice, event: 'unknown.event' }, options)).toMatchObject({ kind: 'error', status: 422 });
    expect(planGatewayRequest({ ...invoice, recipient: { phone: '07700 900123' } }, options)).toMatchObject({ kind: 'error', status: 400 });
    expect(planGatewayRequest({ ...invoice, deliveryId: undefined }, options)).toMatchObject({ kind: 'error', status: 400 });
    expect(planGatewayRequest({ ...invoice, deliveryId: 'campaign:abc' }, options)).toMatchObject({ kind: 'error', status: 400 });
  });

  it('only keeps a status callback on this workspace', () => {
    expect(planGatewayRequest({ ...invoice, statusCallbackUrl: 'https://evil.example/s/whatsapp/status' }, options)).toMatchObject({ kind: 'error', status: 400 });
    expect(planGatewayRequest({ ...invoice, statusCallbackUrl: 'https://crm.acme.co.uk/s/whatsapp/status' }, options)).toMatchObject({ kind: 'single', statusCallbackUrl: 'https://crm.acme.co.uk/s/whatsapp/status' });
  });

  it('plans a campaign batch once per recipient and fills named parameters in the template’s order', () => {
    const recipient = '21bc1b08-4524-4ef2-b0fc-ba5818be5044';
    const other = '31bc1b08-4524-4ef2-b0fc-ba5818be5044';
    const short = '41bc1b08-4524-4ef2-b0fc-ba5818be5044';
    const plan = planGatewayRequest(
      {
        event: 'campaign.message',
        campaignId: 'camp-1',
        batchId: '8e76131c-88c2-41cd-8c79-e881a8f193bb:4f1c0a52-7d0e-4c5e-9a43-0b6f8c2d9e11',
        template: { name: 'spring_offer', language: 'en_GB' },
        messages: [
          { recipientId: recipient, to: '+447700900111', variables: ['Ann', '20%'] },
          { recipientId: recipient, to: '+447700900111', variables: ['Ann', '20%'] },
          { recipientId: other, to: '7700900222', variables: [] },
          { recipientId: short, to: '+447700900333', variables: ['Sue'] },
          { recipientId: 'not-a-uuid', to: '+447700900444' },
        ],
        statusCallbackUrl: 'https://acme.crm.inventiveweb.studio/s/campaigns/whatsapp/status',
      },
      options,
    ) as Extract<GatewayPlan, { kind: 'campaign' }>;
    expect(plan).toMatchObject({ kind: 'campaign', templateName: 'spring_offer', language: 'en_GB', rejected: [other] });
    expect(resolveCampaign(plan, TEMPLATES, 'en_GB')).toEqual({
      items: [{ recipientId: recipient, deliveryKey: `campaign:${recipient}`, phone: '+447700900111', template: { name: 'spring_offer', languageCode: 'en_GB', parameters: { first_name: 'Ann', discount: '20%' } } }],
      rejected: [other, short],
    });
    expect(resolveCampaign({ ...plan, templateName: 'quote_ready' }, TEMPLATES, 'en_GB')).toEqual({ error: 'The WhatsApp template quote_ready is not approved in InventiveChat.' });
    expect(planGatewayRequest({ event: 'campaign.message', batchId: 'b', template: { name: 'spring_offer' }, messages: [] }, options)).toMatchObject({ kind: 'error' });
  });

  it('answers a repeated batch from what it already produced', () => {
    const items = ['a', 'b', 'c', 'd'].map((key) => ({ recipientId: key, deliveryKey: `campaign:${key}` }));
    const now = Date.parse('2026-11-18T10:00:00.000Z');
    const { accepted, toSend } = splitBatch(
      items,
      [
        { deliveryId: 'campaign:a', inventiveChatMessageId: 'msg_a', status: 'SENT', retryAt: null },
        { deliveryId: 'campaign:b', inventiveChatMessageId: null, status: 'QUEUED', retryAt: '2026-11-18T10:15:00.000Z' },
        { deliveryId: 'campaign:c', inventiveChatMessageId: null, status: 'FAILED', retryAt: null },
      ],
      now,
    );
    expect(accepted).toEqual([
      { recipientId: 'a', messageId: 'msg_a' },
      { recipientId: 'b', messageId: null },
    ]);
    expect(toSend.map((item) => item.recipientId)).toEqual(['c', 'd']);
  });

  it('reports a wait as accepted and queued, never as a failure', () => {
    expect(answerForSingle({ state: 'sent', messageId: 'msg_1' })).toEqual({ status: 200, body: { messageId: 'msg_1' } });
    expect(answerForSingle({ state: 'deferred', reason: 'A teammate is chatting', retryAt: '2026-11-18T10:15:00.000Z', code: 'human_active' })).toMatchObject({ status: 202, body: { messageId: null, queued: true } });
    expect(answerForSingle({ state: 'failed', error: 'Refused' })).toEqual({ status: 422, body: { error: 'Refused' } });
  });

  it('reads the mapping in settings and the request’s fields', () => {
    expect(resolvePath(invoice, 'document.amountDue')).toBe('£114.00');
    expect(resolvePath(invoice, 'document.amountDue.amountPence')).toBe('11400');
    expect(resolvePath(invoice, 'recipient.firstName')).toBe('Sam');
    expect(resolvePath(invoice, 'document.missing.value')).toBe('');
    expect(readMapping('{"invoice.send":{"name":"invoice_ready","parameters":{"customer_name":"recipient.name","bad name":"x","total":"not a path!"}}}')).toEqual({ 'invoice.send': { name: 'invoice_ready', parameters: { customer_name: 'recipient.name' } } });
    expect(readMapping('not json')).toEqual({});
    expect(Object.keys(effectiveMapping(null))).toEqual(['invoice.send', 'credit_note.send', 'quote.send', 'invoice.overdue_reminder', 'invoice.payment_link', 'feedback.survey']);
  });
});

describe('status callbacks', () => {
  it('go only to this workspace', () => {
    expect(isOwnCallbackUrl('https://acme.crm.inventiveweb.studio/s/whatsapp/status', ORIGINS)).toBe(true);
    expect(isOwnCallbackUrl('https://acme.crm.inventiveweb.studio.evil.example/s/whatsapp/status', ORIGINS)).toBe(false);
    expect(isOwnCallbackUrl('https://glow.crm.inventiveweb.studio/s/whatsapp/status', ORIGINS)).toBe(false);
    expect(isOwnCallbackUrl('https://acme.crm.inventiveweb.studio/rest/people', ORIGINS)).toBe(false);
    expect(isOwnCallbackUrl('https://user:pass@acme.crm.inventiveweb.studio/s/x', ORIGINS)).toBe(false);
    expect(isOwnCallbackUrl('javascript:alert(1)', ORIGINS)).toBe(false);
    expect(isOwnCallbackUrl(42, ORIGINS)).toBe(false);
  });

  it('use the shapes the other apps expect', () => {
    const document = { deliveryId: 'd1', gatewayEvent: 'invoice.send', inventiveChatMessageId: 'msg_1', error: null };
    expect(callbackBody(document, 'DELIVERED')).toEqual({ deliveryId: 'd1', messageId: 'msg_1', status: 'delivered' });
    expect(callbackBody({ ...document, error: 'Number not on WhatsApp' }, 'FAILED')).toEqual({ deliveryId: 'd1', messageId: 'msg_1', status: 'failed', error: 'Number not on WhatsApp' });
    expect(callbackBody(document, 'QUEUED')).toBeNull();
    const campaign = { deliveryId: 'campaign:r1', gatewayEvent: 'campaign.message', inventiveChatMessageId: 'msg_2', error: null };
    expect(callbackBody(campaign, 'READ')).toEqual({ recipientId: 'r1', status: 'read' });
    expect(callbackBody(campaign, 'OPTED_OUT')).toEqual({ recipientId: 'r1', status: 'opted_out' });
    expect(callbackBody(campaign, 'SENT')).toBeNull();
    expect(callbackBody({ ...document, deliveryId: null }, 'DELIVERED')).toBeNull();
  });
});
