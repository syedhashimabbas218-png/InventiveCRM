import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApiClient } from './helpers/api-client.ts';
import type { SeededTenant } from './helpers/fixtures.ts';
import { createTestContext, type TestContext } from './helpers/test-context.ts';

let context: TestContext;
let api: ReturnType<typeof createApiClient>;
let plumber: SeededTenant;
let dentist: SeededTenant;
let customerSequence = 0;
const newCustomer = () => `4477002${String(10000 + ++customerSequence)}`;

const get = (tenant: SeededTenant, url: string, token = tenant.apiToken) =>
  context.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });

describe('REST API', () => {
  before(async () => {
    context = await createTestContext();
    api = createApiClient(context);
    plumber = await context.seedTenant('Ahmed Plumbing');
    dentist = await context.seedTenant('Bright Dental');
  });

  after(async () => {
    await context?.close();
  });

  it('lists conversations awaiting a reply and drops them once answered', async () => {
    const { conversationId, messageId } = await api.customerSays(plumber, newCustomer(), 'Any slots tomorrow?');
    context.advance(10_000);
    const waiting = await get(plumber, '/v1/conversations?awaiting_reply=true');
    assert.ok(waiting.json().conversations.some((row: { id: string }) => row.id === conversationId));

    const claimId = (await api.claim(plumber, conversationId, messageId)).json().claim_id;
    assert.equal((await api.aiSend(plumber, conversationId, claimId, 'Yes, 10am or 2pm.')).statusCode, 200);
    const after = await get(plumber, '/v1/conversations?awaiting_reply=true');
    assert.ok(!after.json().conversations.some((row: { id: string }) => row.id === conversationId));
  });

  it('returns conversation state and message history, oldest first', async () => {
    const customer = newCustomer();
    const { conversationId, messageId } = await api.customerSays(plumber, customer, 'first');
    await api.customerSays(plumber, customer, 'second');
    const conversation = await get(plumber, `/v1/conversations/${conversationId}`);
    assert.equal(conversation.json().state, 'AI_ACTIVE');
    assert.equal(conversation.json().window.open, true);
    assert.notEqual(conversation.json().latest_message_id, messageId);
    const messages = await get(plumber, `/v1/conversations/${conversationId}/messages?limit=10`);
    assert.deepEqual(messages.json().messages.map((message: { body: string }) => message.body), ['first', 'second']);
  });

  it('hides other tenants and rejects missing credentials', async () => {
    const { conversationId } = await api.customerSays(dentist, newCustomer(), 'private');
    assert.equal((await get(plumber, `/v1/conversations/${conversationId}`)).statusCode, 404);
    assert.equal((await get(plumber, `/v1/conversations/${conversationId}/messages`)).statusCode, 404);
    assert.ok(!(await get(plumber, '/v1/conversations')).body.includes(conversationId));
    assert.equal((await context.app.inject({ method: 'GET', url: '/v1/conversations' })).statusCode, 401);
  });

  it('hands off to a human: AI is paused, an event is published, claims are refused', async () => {
    const { conversationId, messageId } = await api.customerSays(plumber, newCustomer(), 'I want to complain');
    context.advance(10_000);
    const response = await api.call(
      `/v1/conversations/${conversationId}/handoff`,
      plumber.apiToken,
      api.envelope(plumber.tenantId, { type: 'agent', id: 'external-agent' }, { reason: 'complaint', summary: 'Unhappy with last visit' }),
    );
    assert.equal(response.statusCode, 200);
    assert.equal(context.published.at(-1)?.payload.type, 'conversation.handoff_requested');
    assert.equal((await api.claim(plumber, conversationId, messageId)).json().reason, 'paused');
    const invalid = await api.call(`/v1/conversations/${conversationId}/handoff`, plumber.apiToken, api.envelope(plumber.tenantId, { type: 'agent', id: 'a' }, { reason: 'bored' }));
    assert.equal(invalid.statusCode, 422);
  });

  it('releases a claim so another run can take it', async () => {
    const { conversationId, messageId } = await api.customerSays(plumber, newCustomer(), 'hello');
    context.advance(10_000);
    const claimId = (await api.claim(plumber, conversationId, messageId)).json().claim_id;
    assert.equal((await api.claim(plumber, conversationId, messageId)).json().reason, 'already_claimed');
    const released = await api.call(`/v1/conversations/${conversationId}/release`, plumber.apiToken, api.envelope(plumber.tenantId, { type: 'agent', id: 'a' }, { claim_id: claimId }));
    assert.equal(released.statusCode, 200);
    assert.equal((await api.claim(plumber, conversationId, messageId)).statusCode, 200);
  });

  it('enforces what each actor type may do', async () => {
    const { conversationId, messageId } = await api.customerSays(plumber, newCustomer(), 'hello');
    context.advance(10_000);
    const inboxClaim = await api.call(
      `/v1/conversations/${conversationId}/claim`,
      plumber.inboxToken,
      api.envelope(plumber.tenantId, { type: 'user', id: 'owner' }, { claimant: 'ai', latest_message_id: messageId }),
    );
    assert.deepEqual(inboxClaim.json(), { error: 'operation_not_allowed_for_actor' });
    const spoofedActor = await api.call(
      '/v1/messages/send',
      plumber.inboxToken,
      api.envelope(plumber.tenantId, { type: 'agent', id: 'x' }, { conversation_id: conversationId, claim_id: 'clm_x', type: 'text', body: 'x' }),
    );
    assert.deepEqual(spoofedActor.json(), { error: 'actor_not_allowed' });
  });

  it('writes every state-changing call to the tenant audit log', async () => {
    const rows = (await context.database.owner.query('SELECT action, decision FROM audit_log WHERE tenant_id = $1', [plumber.tenantId])).rows;
    const seen = new Set(rows.map((row) => `${row.action}:${row.decision}`));
    for (const expected of ['conversation.claim:allowed', 'conversation.claim:denied', 'message.send:allowed', 'conversation.handoff:allowed', 'conversation.release:allowed']) {
      assert.ok(seen.has(expected), expected);
    }
    const dentistRows = (await context.database.owner.query('SELECT 1 FROM audit_log WHERE tenant_id = $1', [dentist.tenantId])).rows;
    assert.equal(dentistRows.length, 0);
  });
});
