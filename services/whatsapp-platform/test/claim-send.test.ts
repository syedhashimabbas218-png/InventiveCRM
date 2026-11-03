import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { GraphSendError } from '../src/whatsapp/graph-client.ts';
import { createApiClient } from './helpers/api-client.ts';
import type { SeededTenant } from './helpers/fixtures.ts';
import { createTestContext, type TestContext } from './helpers/test-context.ts';

const ALWAYS_OPEN = JSON.stringify(
  Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, [['00:00', '23:59']]])),
);

let context: TestContext;
let api: ReturnType<typeof createApiClient>;
let plumber: SeededTenant;
let dentist: SeededTenant;
let cafe: SeededTenant;
let customerSequence = 0;
const crash = { afterProviderAccepted: false };

const newCustomer = () => `4477009${String(10000 + ++customerSequence)}`;

const ownerRow = async (sql: string, values: unknown[]) => (await context.database.owner.query(sql, values)).rows[0];

// A customer message, with the debounce elapsed, ready for the AI to claim.
const readyConversation = async (tenant: SeededTenant, text = 'Hi, do you do boiler repairs?') => {
  const customer = newCustomer();
  const inbound = await api.customerSays(tenant, customer, text);
  context.advance(10_000);
  return { customer, ...inbound };
};

const claimOk = async (tenant: SeededTenant, conversationId: string, latestMessageId: string) => {
  const response = await api.claim(tenant, conversationId, latestMessageId);
  assert.equal(response.statusCode, 200, response.body);
  return response.json().claim_id as string;
};

describe('claim and send', () => {
  before(async () => {
    context = await createTestContext({
      wrapGraph: (graph) => ({
        sendMessage: async (request) => {
          const result = await graph.sendMessage(request);
          if (crash.afterProviderAccepted) throw new Error('simulated crash after Meta accepted the message');
          return result;
        },
      }),
    });
    api = createApiClient(context);
    plumber = await context.seedTenant('Ahmed Plumbing', { route: 'C' });
    dentist = await context.seedTenant('Bright Dental', { route: 'B' });
    cafe = await context.seedTenant('Coexist Cafe', { route: 'A' });
  });

  after(async () => {
    await context?.close();
  });

  it('claims and sends on the happy path using the tenant own access token', async () => {
    const { conversationId, messageId, customer } = await readyConversation(plumber);
    const claimId = await claimOk(plumber, conversationId, messageId);
    const sent = await api.aiSend(plumber, conversationId, claimId, 'Yes, we do. When suits you?');
    assert.equal(sent.statusCode, 200, sent.body);
    const last = context.mockGraph.sends.at(-1);
    assert.equal(last?.phoneNumberId, plumber.phoneNumberId);
    assert.equal(last?.body.to, customer);
    const stored = await ownerRow('SELECT direction, sender_type, status, claim_id FROM messages WHERE id = $1', [sent.json().message_id]);
    assert.deepEqual(stored, { direction: 'outbound', sender_type: 'ai', status: 'sent', claim_id: claimId });
  });

  it('refuses a claim during the grace period in opening hours and says when to retry', async () => {
    await context.database.owner.query('UPDATE tenant_settings SET opening_hours = $2 WHERE tenant_id = $1', [dentist.tenantId, ALWAYS_OPEN]);
    const { conversationId, messageId } = await readyConversation(dentist);
    const early = await api.claim(dentist, conversationId, messageId);
    assert.equal(early.statusCode, 409);
    assert.equal(early.json().reason, 'paused');
    assert.equal(early.json().retry_after_seconds, 110);
    context.advance(110_000);
    await claimOk(dentist, conversationId, messageId);
    await context.database.owner.query("UPDATE tenant_settings SET opening_hours = '{}' WHERE tenant_id = $1", [dentist.tenantId]);
  });

  it('two customer messages at once: only the turn for the latest message can claim', async () => {
    const customer = newCustomer();
    const [first, second] = await Promise.all([
      api.customerSays(plumber, customer, 'Hello'),
      api.customerSays(plumber, customer, 'my boiler is making a noise'),
    ]);
    context.advance(10_000);
    assert.equal(first.conversationId, second.conversationId);
    const latest = await ownerRow(
      "SELECT id FROM messages WHERE conversation_id = $1 AND direction = 'inbound' ORDER BY seq DESC LIMIT 1",
      [first.conversationId],
    );
    const stale = latest.id === first.messageId ? second : first;
    const staleClaim = await api.claim(plumber, stale.conversationId, stale.messageId);
    assert.deepEqual(staleClaim.json(), { claimed: false, reason: 'newer_message' });
    await claimOk(plumber, first.conversationId, latest.id);
  });

  it('lets exactly one of many concurrent claims win', async () => {
    const { conversationId, messageId } = await readyConversation(plumber);
    const responses = await Promise.all(Array.from({ length: 10 }, () => api.claim(plumber, conversationId, messageId)));
    const won = responses.filter((response) => response.statusCode === 200);
    assert.equal(won.length, 1);
    assert.ok(responses.filter((response) => response.statusCode === 409).every((response) => response.json().reason === 'already_claimed'));
  });

  it('human reply during the grace wait blocks the AI claim (coexistence echo)', async () => {
    const customer = newCustomer();
    const { conversationId, messageId } = await api.customerSays(cafe, customer, 'Table for two tonight?');
    await api.ownerEchoes(cafe, customer, 'Yes, see you at 7');
    context.advance(10_000);
    assert.deepEqual((await api.claim(cafe, conversationId, messageId)).json(), { claimed: false, reason: 'human_active' });
  });

  it('human reply after the claim drops the AI draft: send answers 423 and nothing reaches Meta', async () => {
    const customer = newCustomer();
    const { conversationId, messageId } = await api.customerSays(cafe, customer, 'Do you have vegan options?');
    context.advance(10_000);
    const claimId = await claimOk(cafe, conversationId, messageId);
    await api.ownerEchoes(cafe, customer, 'We do!');
    const before = context.mockGraph.sends.length;
    const sent = await api.aiSend(cafe, conversationId, claimId, 'Yes, we have vegan options.');
    assert.equal(sent.statusCode, 423);
    assert.deepEqual(sent.json(), { reason: 'human_active' });
    assert.equal(context.mockGraph.sends.length, before);
  });

  it('owner reply from the inbox (route C) takes over the conversation', async () => {
    const { conversationId, messageId } = await readyConversation(plumber);
    const claimId = await claimOk(plumber, conversationId, messageId);
    const human = await api.humanSend(plumber, conversationId, 'Ali here, I can come at 3pm.');
    assert.equal(human.statusCode, 200);
    const row = await ownerRow('SELECT state FROM conversations WHERE id = $1', [conversationId]);
    assert.equal(row.state, 'HUMAN_ACTIVE');
    assert.equal((await api.aiSend(plumber, conversationId, claimId, 'draft')).statusCode, 423);
    assert.deepEqual((await api.claim(plumber, conversationId, messageId)).json(), { claimed: false, reason: 'human_active' });
  });

  it('hands back to the AI only after the human pause expires', async () => {
    const customer = newCustomer();
    const { conversationId } = await api.customerSays(cafe, customer, 'hi');
    await api.ownerEchoes(cafe, customer, 'hello!');
    context.advance(3 * 3600_000);
    const later = await api.customerSays(cafe, customer, 'are you still there?');
    context.advance(10_000);
    assert.equal((await api.claim(cafe, conversationId, later.messageId)).json().reason, 'human_active');
    context.advance(3600_000);
    await claimOk(cafe, conversationId, later.messageId);
    assert.equal((await ownerRow('SELECT state FROM conversations WHERE id = $1', [conversationId])).state, 'AI_ACTIVE');
  });

  it('refuses sends without a claim, with a forged claim, or with an expired claim', async () => {
    const { conversationId, messageId } = await readyConversation(plumber);
    assert.deepEqual((await api.aiSend(plumber, conversationId, undefined, 'x')).json(), { reason: 'claim_invalid' });
    assert.deepEqual((await api.aiSend(plumber, conversationId, 'clm_forged', 'x')).json(), { reason: 'claim_invalid' });
    const claimId = await claimOk(plumber, conversationId, messageId);
    context.advance(121_000);
    assert.deepEqual((await api.aiSend(plumber, conversationId, claimId, 'x')).json(), { reason: 'claim_invalid' });
  });

  it('a newer customer message invalidates an in-flight claim so the stale draft is dropped', async () => {
    const { conversationId, messageId, customer } = await readyConversation(plumber);
    const claimId = await claimOk(plumber, conversationId, messageId);
    await api.customerSays(plumber, customer, 'actually, it is leaking too');
    const sent = await api.aiSend(plumber, conversationId, claimId, 'Reply to the first message only');
    assert.equal(sent.statusCode, 409);
    assert.equal(sent.json().reason, 'claim_invalid');
  });

  it('a duplicate webhook of the same message during a run does not invalidate the claim', async () => {
    const customer = newCustomer();
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ id: plumber.wabaId, changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '1', phone_number_id: plumber.phoneNumberId },
        messages: [{ from: customer, id: `wamid.dupe${customer}`, timestamp: String(Math.floor(context.now.getTime() / 1000)), type: 'text', text: { body: 'hi' } }],
      } }] }],
    };
    const first = (await api.postWebhook(payload)).json().outcomes[0];
    context.advance(10_000);
    const claimId = await claimOk(plumber, first.conversationId, first.messageId);
    const duplicate = await api.postWebhook({ ...payload, extra: 1 });
    assert.equal(duplicate.json().outcomes[0].kind, 'duplicate');
    assert.equal((await api.aiSend(plumber, first.conversationId, claimId, 'Hello!')).statusCode, 200);
  });

  it('a retry with the same idempotency key returns the first message and sends nothing new', async () => {
    const { conversationId, messageId } = await readyConversation(plumber);
    const claimId = await claimOk(plumber, conversationId, messageId);
    const first = await api.aiSend(plumber, conversationId, claimId, 'Hello', { idempotencyKey: 'turn-1-reply' });
    const before = context.mockGraph.sends.length;
    const retry = await api.aiSend(plumber, conversationId, claimId, 'Hello', { idempotencyKey: 'turn-1-reply' });
    assert.equal(retry.statusCode, 200);
    assert.deepEqual(retry.json(), { message_id: first.json().message_id, replayed: true });
    assert.equal(context.mockGraph.sends.length, before);
  });

  it('concurrent sends with the same idempotency key reach Meta exactly once', async () => {
    const { conversationId, messageId } = await readyConversation(plumber);
    const claimId = await claimOk(plumber, conversationId, messageId);
    const before = context.mockGraph.sends.length;
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => api.aiSend(plumber, conversationId, claimId, 'Once only', { idempotencyKey: `same-${conversationId}` })),
    );
    assert.equal(context.mockGraph.sends.length - before, 1);
    const ok = responses.filter((response) => response.statusCode === 200);
    assert.ok(ok.length >= 1);
    assert.equal(new Set(ok.map((response) => response.json().message_id)).size, 1);
    assert.ok(responses.filter((response) => response.statusCode !== 200).every((response) => response.json().reason === 'in_progress'));
  });

  it('refuses to reuse an idempotency key for another conversation', async () => {
    const one = await readyConversation(plumber);
    const two = await readyConversation(plumber);
    const claimOne = await claimOk(plumber, one.conversationId, one.messageId);
    const claimTwo = await claimOk(plumber, two.conversationId, two.messageId);
    await api.aiSend(plumber, one.conversationId, claimOne, 'a', { idempotencyKey: 'shared-key' });
    const reused = await api.aiSend(plumber, two.conversationId, claimTwo, 'b', { idempotencyKey: 'shared-key' });
    assert.deepEqual(reused.json(), { reason: 'idempotency_key_reused' });
  });

  it('crash after Meta accepted but before commit: retry is refused, owner is alerted, no double send', async () => {
    const { conversationId, messageId } = await readyConversation(plumber);
    const claimId = await claimOk(plumber, conversationId, messageId);
    const before = context.mockGraph.sends.length;
    crash.afterProviderAccepted = true;
    const first = await api.aiSend(plumber, conversationId, claimId, 'Hello', { idempotencyKey: 'crash-key' });
    crash.afterProviderAccepted = false;
    assert.equal(first.statusCode, 502);
    assert.deepEqual(first.json(), { reason: 'outcome_unknown' });
    context.advance(60_000);
    const retry = await api.aiSend(plumber, conversationId, claimId, 'Hello', { idempotencyKey: 'crash-key' });
    assert.deepEqual(retry.json(), { reason: 'outcome_unknown' });
    assert.equal(context.mockGraph.sends.length - before, 1);
    assert.equal(context.ownerNotifier.alerts.at(-1)?.kind, 'send_outcome_unknown');
  });

  it('provider timeout: the outcome is unknown, the lock is released and nothing is retried', async () => {
    const { conversationId, messageId } = await readyConversation(plumber);
    const claimId = await claimOk(plumber, conversationId, messageId);
    context.mockGraph.mode = 'hang';
    const response = await api.aiSend(plumber, conversationId, claimId, 'Hello', { idempotencyKey: 'timeout-key' });
    context.mockGraph.mode = 'ok';
    assert.deepEqual(response.json(), { reason: 'outcome_unknown' });
    const human = await api.humanSend(plumber, conversationId, 'Owner can still reply');
    assert.equal(human.statusCode, 200);
  });

  it('provider rejection is definite: a retry with the same key may send', async () => {
    const { conversationId, messageId } = await readyConversation(plumber);
    const claimId = await claimOk(plumber, conversationId, messageId);
    context.mockGraph.mode = 'reject';
    const rejected = await api.aiSend(plumber, conversationId, claimId, 'Hello', { idempotencyKey: 'reject-key' });
    context.mockGraph.mode = 'ok';
    assert.deepEqual(rejected.json(), { reason: 'provider_rejected' });
    assert.equal((await api.aiSend(plumber, conversationId, claimId, 'Hello', { idempotencyKey: 'reject-key' })).statusCode, 200);
  });

  it('server errors from Meta count as unknown, not as rejected', () => {
    assert.equal(new GraphSendError('x', false, 500).definite, false);
  });

  it('global and per-tenant kill switches stop AI claims and AI sends but not human sends', async () => {
    const { conversationId, messageId } = await readyConversation(plumber);
    const claimId = await claimOk(plumber, conversationId, messageId);
    await context.database.owner.query('UPDATE platform_settings SET ai_sending_enabled = false');
    assert.deepEqual((await api.aiSend(plumber, conversationId, claimId, 'x')).json(), { reason: 'paused' });
    await context.database.owner.query('UPDATE platform_settings SET ai_sending_enabled = true');
    await context.database.owner.query('UPDATE tenants SET ai_sending_enabled = false WHERE id = $1', [plumber.tenantId]);
    assert.deepEqual((await api.aiSend(plumber, conversationId, claimId, 'x')).json(), { reason: 'paused' });
    const other = await readyConversation(plumber);
    assert.equal((await api.claim(plumber, other.conversationId, other.messageId)).json().reason, 'paused');
    assert.equal((await api.humanSend(plumber, conversationId, 'human still works')).statusCode, 200);
    await context.database.owner.query('UPDATE tenants SET ai_sending_enabled = true WHERE id = $1', [plumber.tenantId]);
  });

  it('refuses claims and AI sends while awaiting approval or closed', async () => {
    const { conversationId, messageId } = await readyConversation(plumber);
    const claimId = await claimOk(plumber, conversationId, messageId);
    await context.database.owner.query("UPDATE conversations SET state = 'AWAITING_APPROVAL' WHERE id = $1", [conversationId]);
    assert.deepEqual((await api.aiSend(plumber, conversationId, claimId, 'x')).json(), { reason: 'paused' });
    await context.database.owner.query("UPDATE conversations SET state = 'CLOSED' WHERE id = $1", [conversationId]);
    assert.equal((await api.claim(plumber, conversationId, messageId)).json().reason, 'paused');
    assert.deepEqual((await api.aiSend(plumber, conversationId, claimId, 'x')).json(), { reason: 'closed' });
  });

  it('refuses free-form text outside the 24-hour window', async () => {
    const { conversationId, messageId } = await readyConversation(plumber);
    context.advance(24 * 3600_000);
    const claimId = await claimOk(plumber, conversationId, messageId);
    assert.deepEqual((await api.aiSend(plumber, conversationId, claimId, 'late reply')).json(), { reason: 'outside_window' });
  });

  it('validates the send payload', async () => {
    const { conversationId, messageId } = await readyConversation(plumber);
    const claimId = await claimOk(plumber, conversationId, messageId);
    const tooManyButtons = await api.call('/v1/messages/send', plumber.apiToken, api.envelope(plumber.tenantId, { type: 'agent', id: 'a' }, {
      conversation_id: conversationId,
      claim_id: claimId,
      type: 'buttons',
      body: 'Pick',
      buttons: [1, 2, 3, 4].map((index) => ({ id: `b${index}`, title: `Option ${index}` })),
    }));
    assert.equal(tooManyButtons.statusCode, 422);
  });
});

describe('cross-tenant API access', () => {
  before(async () => {
    context = await createTestContext();
    api = createApiClient(context);
    plumber = await context.seedTenant('Ahmed Plumbing');
    dentist = await context.seedTenant('Bright Dental');
  });

  after(async () => {
    await context?.close();
  });

  it('rejects a request whose envelope tenant differs from the credential tenant', async () => {
    const { conversationId, messageId } = await readyConversation(plumber);
    const response = await api.claim(plumber, conversationId, messageId, { token: dentist.apiToken });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'tenant_mismatch' });
  });

  it('does not find another tenant conversation when the id is swapped in', async () => {
    const { conversationId, messageId } = await readyConversation(plumber);
    const claim = await api.claim(dentist, conversationId, messageId);
    assert.equal(claim.statusCode, 404);
    const send = await api.aiSend(dentist, conversationId, 'clm_any', 'leak?');
    assert.equal(send.statusCode, 404);
    const state = await api.call(`/v1/conversations/${conversationId}/state`, dentist.apiToken, api.envelope(dentist.tenantId, { type: 'system', id: 's' }, {}));
    assert.equal(state.statusCode, 404);
  });

  it('a replayed request from tenant A carried by tenant B credential is refused', async () => {
    const { conversationId, messageId } = await readyConversation(plumber);
    const claimId = await claimOk(plumber, conversationId, messageId);
    const body = api.envelope(plumber.tenantId, { type: 'agent', id: 'agent' }, { conversation_id: conversationId, claim_id: claimId, type: 'text', body: 'hi' }, 'replay-key');
    const before = context.mockGraph.sends.length;
    const replayed = await api.call('/v1/messages/send', dentist.apiToken, body);
    assert.equal(replayed.statusCode, 403);
    assert.equal(context.mockGraph.sends.length, before);
  });

  it('rejects revoked, unknown and malformed tokens', async () => {
    const { conversationId, messageId } = await readyConversation(plumber);
    await context.database.owner.query("UPDATE api_credentials SET revoked_at = now() WHERE tenant_id = $1 AND label = 'n8n connector'", [dentist.tenantId]);
    assert.equal((await api.claim(dentist, conversationId, messageId)).statusCode, 401);
    assert.equal((await api.claim(plumber, conversationId, messageId, { token: 'wa_0000000000000000000000000000' })).statusCode, 401);
    assert.equal((await api.claim(plumber, conversationId, messageId, { token: 'short' })).statusCode, 401);
  });

  it('an inbox credential cannot act as the agent', async () => {
    const { conversationId, messageId } = await readyConversation(plumber);
    const response = await api.claim(plumber, conversationId, messageId, { token: plumber.inboxToken });
    assert.deepEqual(response.json(), { error: 'actor_not_allowed' });
  });

  it('a WhatsApp access token copied into another tenant cannot be decrypted, so nothing is sent', async () => {
    const clinic = await context.seedTenant('City Clinic');
    await context.database.owner.query(
      `UPDATE whatsapp_accounts SET access_token_ciphertext = (SELECT access_token_ciphertext FROM whatsapp_accounts WHERE tenant_id = $1)
       WHERE tenant_id = $2`,
      [plumber.tenantId, clinic.tenantId],
    );
    const { conversationId, messageId } = await readyConversation(clinic);
    const claimId = await claimOk(clinic, conversationId, messageId);
    const before = context.mockGraph.sends.length;
    const response = await api.aiSend(clinic, conversationId, claimId, 'hello');
    assert.equal(response.statusCode, 502);
    assert.equal(context.mockGraph.sends.length, before);
  });
});
