import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { signEventBody, validateSubscriptionUrl } from '../src/events/subscriptions.ts';
import { createApiClient } from './helpers/api-client.ts';
import type { SeededTenant } from './helpers/fixtures.ts';
import { createTestContext, type TestContext } from './helpers/test-context.ts';
import { messageEcho } from './helpers/webhook-fixtures.ts';

type Received = { headers: Record<string, string | string[] | undefined>; raw: string; body: { tenant_id: string; payload: { type: string; data: Record<string, unknown> } } };

let context: TestContext;
let api: ReturnType<typeof createApiClient>;
let plumber: SeededTenant;
let dentist: SeededTenant;
let cafe: SeededTenant;
let receiver: FastifyInstance;
let receiverUrl = '';
const received: Received[] = [];
const receiverState = { failuresLeft: 0, failPath: '' };
let customerSequence = 0;
const newCustomer = () => `4477004${String(10000 + ++customerSequence)}`;

const subscribe = (tenant: SeededTenant, eventTypes: string[], path: string) =>
  api.call('/v1/subscriptions', tenant.apiToken, api.envelope(tenant.tenantId, { type: 'system', id: 'setup' }, { url: `${receiverUrl}${path}`, event_types: eventTypes }));

const deliver = async () => {
  for (let round = 0; round < 3; round += 1) await context.runJobs();
};
const receivedAt = (path: string) => received.filter((item) => item.headers['x-test-path'] === path || (item as unknown as { path: string }).path === path);

describe('event subscriptions', () => {
  before(async () => {
    receiver = Fastify();
    receiver.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => done(null, body));
    receiver.post('/:path', async (request, reply) => {
      if (receiverState.failuresLeft > 0 && (request.params as { path: string }).path === receiverState.failPath) {
        receiverState.failuresLeft -= 1;
        return reply.code(500).send();
      }
      const raw = request.body as string;
      received.push({ headers: request.headers, raw, body: JSON.parse(raw), path: (request.params as { path: string }).path } as Received & { path: string });
      return { ok: true };
    });
    receiverUrl = `${await receiver.listen({ port: 0, host: '127.0.0.1' })}/`;
    context = await createTestContext();
    api = createApiClient(context);
    plumber = await context.seedTenant('Ahmed Plumbing');
    dentist = await context.seedTenant('Bright Dental');
    cafe = await context.seedTenant('Coexist Cafe', { route: 'A' });
  });

  beforeEach(() => {
    received.length = 0;
  });

  after(async () => {
    await context?.close();
    await receiver?.close();
  });

  it('creates a subscription, shows the secret once, and delivers signed events', async () => {
    const created = await subscribe(plumber, ['message.received'], 'plumber');
    assert.equal(created.statusCode, 201, created.body);
    const { id, secret } = created.json();
    assert.match(secret, /^whsec_[0-9a-f]{64}$/);
    const listed = await context.app.inject({ method: 'GET', url: '/v1/subscriptions', headers: { authorization: `Bearer ${plumber.apiToken}` } });
    assert.equal(listed.json().subscriptions[0].id, id);
    assert.ok(!listed.body.includes(secret));

    const customer = newCustomer();
    await api.customerSays(plumber, customer, 'Hello there');
    await deliver();
    const [event] = receivedAt('plumber');
    assert.equal(event?.body.payload.type, 'message.received');
    assert.equal(event?.body.payload.data.customer, customer);
    assert.deepEqual(event?.body.payload.data.content, { kind: 'text', text: 'Hello there' });
    const timestamp = String(event?.headers['x-signature-timestamp']);
    assert.equal(event?.headers['x-signature-256'], signEventBody(secret, timestamp, event?.raw ?? ''));
    assert.equal(event?.headers['x-event-id'], event?.body && (event.body as unknown as { idempotency_key: string }).idempotency_key);
  });

  it('never delivers one tenant events to another tenant subscription', async () => {
    await subscribe(dentist, ['message.received'], 'dentist');
    await api.customerSays(plumber, newCustomer(), 'for the plumber only');
    await deliver();
    assert.equal(receivedAt('dentist').length, 0);
    assert.ok(receivedAt('plumber').every((event) => event.body.tenant_id === plumber.tenantId));
  });

  it('retries failed deliveries and stops after the subscription is disabled', async () => {
    const created = (await subscribe(dentist, ['message.received'], 'retry')).json();
    receiverState.failuresLeft = 1;
    receiverState.failPath = 'retry';
    await api.customerSays(dentist, newCustomer(), 'retry me');
    await context.runJobs();
    assert.equal(receivedAt('retry').length, 0);
    context.advance(31_000);
    await context.runJobs();
    assert.equal(receivedAt('retry').length, 1);

    const disabled = await api.call(`/v1/subscriptions/${created.id}/disable`, dentist.apiToken, api.envelope(dentist.tenantId, { type: 'system', id: 'setup' }, {}));
    assert.equal(disabled.statusCode, 200);
    await api.customerSays(dentist, newCustomer(), 'after disable');
    await deliver();
    assert.equal(receivedAt('retry').length, 1);
  });

  it('only system credentials manage subscriptions, and event types must be known', async () => {
    const asAgent = await api.call('/v1/subscriptions', plumber.apiToken, api.envelope(plumber.tenantId, { type: 'agent', id: 'a' }, { url: `${receiverUrl}x`, event_types: ['message.received'] }));
    assert.deepEqual(asAgent.json(), { error: 'operation_not_allowed_for_actor' });
    const unknownType = await subscribe(plumber, ['everything'], 'x');
    assert.equal(unknownType.statusCode, 422);
  });

  it('rejects unsafe subscription URLs outside development', () => {
    const strict = { allowInsecureUrls: false };
    assert.equal(validateSubscriptionUrl('https://hooks.n8n.example/webhook/1', strict), undefined);
    for (const url of ['http://hooks.example/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.2/x', 'https://[::1]/x', 'https://user:pw@hooks.example/x', 'not a url']) {
      assert.notEqual(validateSubscriptionUrl(url, strict), undefined, url);
    }
  });

  it('signals ready_for_reply once per burst, after the debounce', async () => {
    await subscribe(plumber, ['conversation.ready_for_reply'], 'ready');
    const customer = newCustomer();
    const first = await api.customerSays(plumber, customer, 'Hi');
    await api.customerSays(plumber, customer, 'I need a plumber');
    const last = await api.customerSays(plumber, customer, 'today if possible');
    await deliver();
    assert.equal(receivedAt('ready').length, 0);
    context.advance(10_000);
    await deliver();
    const ready = receivedAt('ready').filter((event) => event.body.payload.data.customer === customer);
    assert.equal(ready.length, 1);
    assert.deepEqual(ready[0]?.body.payload.data, { conversation_id: first.conversationId, latest_message_id: last.messageId, customer });
  });

  it('waits for the grace period in opening hours, and stays quiet when a human replied', async () => {
    await subscribe(cafe, ['conversation.ready_for_reply'], 'cafe');
    const always = JSON.stringify(Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, [['00:00', '23:59']]])));
    await context.database.owner.query('UPDATE tenant_settings SET opening_hours = $2 WHERE tenant_id = $1', [cafe.tenantId, always]);

    const waiting = newCustomer();
    await api.customerSays(cafe, waiting, 'Table for two?');
    context.advance(60_000);
    await deliver();
    assert.equal(receivedAt('cafe').length, 0);
    context.advance(60_000);
    await deliver();
    assert.equal(receivedAt('cafe').length, 1);

    const answered = newCustomer();
    await api.customerSays(cafe, answered, 'Are you open?');
    await api.postWebhook(messageEcho({ wabaId: cafe.wabaId, phoneNumberId: cafe.phoneNumberId, timestamp: context.now, from: cafe.businessNumber, to: answered, id: `wamid.echo${answered}`, text: 'Yes!' }));
    context.advance(3 * 60_000);
    await deliver();
    assert.equal(receivedAt('cafe').length, 1);
  });
});
