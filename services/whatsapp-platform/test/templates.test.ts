import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { validateTemplateDefinition, type TemplateDefinition } from '../src/templates/templates.ts';
import { createApiClient } from './helpers/api-client.ts';
import type { SeededTenant } from './helpers/fixtures.ts';
import { createTestContext, type TestContext } from './helpers/test-context.ts';

const reminder: TemplateDefinition = {
  name: 'appointment_reminder',
  language: 'en_GB',
  category: 'utility',
  body: 'Reminder: your appointment with {{business_name}} is on {{date}} at {{time}}.',
  parameters: ['business_name', 'date', 'time'],
  quick_replies: ['Confirm', 'Reschedule'],
};

describe('template definition rules (Meta limits)', () => {
  it('accepts a valid named-parameter template', () => {
    assert.deepEqual(validateTemplateDefinition(reminder), []);
  });

  it('rejects what Meta would reject', () => {
    assert.ok(validateTemplateDefinition({ ...reminder, body: 'Hi {{1}}', parameters: ['1'] }).length > 0);
    assert.ok(validateTemplateDefinition({ ...reminder, quick_replies: ['Confirm & pay now!'] }).length > 0);
    assert.ok(validateTemplateDefinition({ ...reminder, parameters: ['time', 'date', 'business_name'] }).length > 0);
    assert.ok(validateTemplateDefinition({ ...reminder, body: 'x'.repeat(1025), parameters: [] }).length > 0);
    assert.ok(validateTemplateDefinition({ ...reminder, name: 'Has Spaces' }).length > 0);
  });
});

let context: TestContext;
let api: ReturnType<typeof createApiClient>;
let salon: SeededTenant;
let barber: SeededTenant;
let customerSequence = 0;
const newCustomer = () => `4477003${String(10000 + ++customerSequence)}`;

const putTemplate = (tenant: SeededTenant, template: Record<string, unknown>, actor: 'system' | 'agent' = 'system') =>
  api.call('/v1/templates', tenant.apiToken, api.envelope(tenant.tenantId, { type: actor, id: 'setup' }, template));

const reminderSend = (overrides: Record<string, unknown> = {}) => ({
  name: 'appointment_reminder',
  language_code: 'en_GB',
  parameters: { business_name: 'Glow Salon', date: 'Thursday 5 November', time: '10:00' },
  quick_reply_payloads: ['confirm:1', 'reschedule:1'],
  ...overrides,
});

const claimedConversation = async (tenant: SeededTenant, customer = newCustomer()) => {
  const { conversationId, messageId } = await api.customerSays(tenant, customer, 'hi');
  context.advance(25 * 3600_000);
  const claimId = (await api.claim(tenant, conversationId, messageId)).json().claim_id as string;
  return { conversationId, claimId, customer };
};

const sendTemplate = (tenant: SeededTenant, conversationId: string, claimId: string, template: Record<string, unknown>, key?: string) =>
  api.call(
    '/v1/messages/send',
    tenant.apiToken,
    api.envelope(tenant.tenantId, { type: 'system', id: 'n8n' }, { conversation_id: conversationId, claim_id: claimId, type: 'template', template }, key),
  );

const templateStatusWebhook = (tenant: SeededTenant, event: string, language = 'en-GB') => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: tenant.wabaId,
      time: Math.floor(context.now.getTime() / 1000),
      changes: [
        {
          field: 'message_template_status_update',
          value: { event, message_template_id: 1689556908129832, message_template_name: 'appointment_reminder', message_template_language: language, reason: 'NONE' },
        },
      ],
    },
  ],
});

describe('per-client templates', () => {
  before(async () => {
    context = await createTestContext();
    api = createApiClient(context);
    salon = await context.seedTenant('Glow Salon');
    barber = await context.seedTenant('Sharp Barber');
  });

  after(async () => {
    await context?.close();
  });

  it('registers a template per client; only system credentials may do it', async () => {
    assert.deepEqual((await putTemplate(salon, { ...reminder }, 'agent')).json(), { error: 'operation_not_allowed_for_actor' });
    const saved = await putTemplate(salon, { ...reminder });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().status, 'pending');
    const invalid = await putTemplate(salon, { ...reminder, quick_replies: ['Way too long a label for Meta'] });
    assert.equal(invalid.statusCode, 422);
    const salonList = await context.app.inject({ method: 'GET', url: '/v1/templates', headers: { authorization: `Bearer ${salon.apiToken}` } });
    assert.deepEqual(salonList.json().templates.map((template: { name: string }) => template.name), ['appointment_reminder']);
    const barberList = await context.app.inject({ method: 'GET', url: '/v1/templates', headers: { authorization: `Bearer ${barber.apiToken}` } });
    assert.deepEqual(barberList.json().templates, []);
  });

  it('refuses a template until Meta approves it, then follows status webhooks (en-US style codes included)', async () => {
    const { conversationId, claimId } = await claimedConversation(salon);
    assert.deepEqual((await sendTemplate(salon, conversationId, claimId, reminderSend())).json().errors, ['template status is pending']);

    const approved = await api.postWebhook(templateStatusWebhook(salon, 'APPROVED'));
    assert.equal(approved.json().outcomes[0].kind, 'template_status_updated');
    assert.equal((await sendTemplate(salon, conversationId, claimId, reminderSend())).statusCode, 200);

    await api.postWebhook(templateStatusWebhook(salon, 'PAUSED'));
    assert.deepEqual((await sendTemplate(salon, conversationId, claimId, reminderSend())).json().errors, ['template status is paused']);
    await api.postWebhook(templateStatusWebhook(salon, 'REINSTATED'));
    assert.equal((await sendTemplate(salon, conversationId, claimId, reminderSend())).statusCode, 200);

    const otherWaba = await api.postWebhook({ ...templateStatusWebhook(salon, 'APPROVED'), entry: [{ ...templateStatusWebhook(salon, 'APPROVED').entry[0], id: 'waba-unknown' }] });
    assert.equal(otherWaba.json().outcomes[0].reason, 'unknown_business_account');
  });

  it('has no per-customer cap on template sends', async () => {
    const { conversationId, claimId } = await claimedConversation(salon);
    for (let index = 0; index < 6; index += 1) {
      const response = await sendTemplate(salon, conversationId, claimId, reminderSend());
      assert.equal(response.statusCode, 200, `send ${index + 1}: ${response.body}`);
    }
  });

  it('one client cannot send another client template', async () => {
    const { conversationId, claimId } = await claimedConversation(barber);
    assert.deepEqual((await sendTemplate(barber, conversationId, claimId, reminderSend())).json().errors, ['template is not registered for this client']);
  });

  it('checks parameters and quick replies against the client definition', async () => {
    const { conversationId, claimId } = await claimedConversation(salon);
    for (const template of [
      reminderSend({ parameters: { business_name: 'Glow Salon' } }),
      reminderSend({ parameters: { business_name: 'Glow\nSalon', date: 'x', time: 'y' } }),
      reminderSend({ quick_reply_payloads: [] }),
      reminderSend({ language_code: 'en_US' }),
    ]) {
      assert.equal((await sendTemplate(salon, conversationId, claimId, template)).statusCode, 422, JSON.stringify(template));
    }
    const sent = context.mockGraph.sends.at(-1)?.body as { template: { components: { type: string; parameters: unknown[] }[] } };
    assert.deepEqual(sent.template.components[0]?.parameters[0], { type: 'text', parameter_name: 'business_name', text: 'Glow Salon' });
  });

  it('still respects STOP, and marketing templates need recorded consent', async () => {
    const customer = newCustomer();
    const { conversationId } = await claimedConversation(salon, customer);
    await api.customerSays(salon, customer, 'STOP');
    context.advance(10_000);
    const latest = (await context.database.owner.query("SELECT id FROM messages WHERE conversation_id = $1 AND direction = 'inbound' ORDER BY seq DESC LIMIT 1", [conversationId])).rows[0];
    const claimId = (await api.claim(salon, conversationId, latest.id)).json().claim_id;
    assert.deepEqual((await sendTemplate(salon, conversationId, claimId, reminderSend())).json(), { reason: 'opted_out' });

    await putTemplate(salon, { name: 'winback', language: 'en_GB', category: 'marketing', body: 'We miss you at {{business_name}}.', parameters: ['business_name'], quick_replies: [], status: 'approved' });
    const fresh = await claimedConversation(salon);
    const marketing = await sendTemplate(salon, fresh.conversationId, fresh.claimId, { name: 'winback', language_code: 'en_GB', parameters: { business_name: 'Glow Salon' } });
    assert.deepEqual(marketing.json(), { reason: 'opted_out' });
  });
});
