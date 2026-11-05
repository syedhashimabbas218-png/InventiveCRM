import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { withTenant } from '../src/db/pool.ts';
import { signWebhookBody } from '../src/messaging/signature.ts';
import type { SeededTenant } from './helpers/fixtures.ts';
import { createTestContext, TEST_APP_SECRET, TEST_VERIFY_TOKEN, type TestContext } from './helpers/test-context.ts';
import { messageEcho, statusUpdate, textMessage, voiceNote } from './helpers/webhook-fixtures.ts';

const CUSTOMER = '447700900123';
let context: TestContext;
let tenantA: SeededTenant;
let tenantB: SeededTenant;
let coexistence: SeededTenant;
let sequence = 0;

const nextId = () => `wamid.test${++sequence}`;

const post = (payload: unknown, options: { secret?: string; signature?: string; raw?: string } = {}) => {
  const raw = options.raw ?? JSON.stringify(payload);
  return context.app.inject({
    method: 'POST',
    url: '/webhooks/whatsapp',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': options.signature ?? signWebhookBody(options.secret ?? TEST_APP_SECRET, raw),
    },
    payload: raw,
  });
};

const fixtureFor = (tenant: SeededTenant) => ({
  wabaId: tenant.wabaId,
  phoneNumberId: tenant.phoneNumberId,
  timestamp: context.now,
});

const ownerQuery = async (sql: string, values: unknown[]) => (await context.database.owner.query(sql, values)).rows;

describe('webhook ingest', () => {
  before(async () => {
    context = await createTestContext();
    tenantA = await context.seedTenant('Ahmed Plumbing');
    tenantB = await context.seedTenant('Bright Dental');
    coexistence = await context.seedTenant('Coexist Cafe', { route: 'A' });
  });

  beforeEach(() => {
    context.setNow(new Date(context.now.getTime() + 60_000));
  });

  after(async () => {
    await context?.close();
  });

  it('answers the verification challenge only with the right token', async () => {
    const ok = await context.app.inject({
      method: 'GET',
      url: `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${TEST_VERIFY_TOKEN}&hub.challenge=1158201444`,
    });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body, '1158201444');
    const bad = await context.app.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1',
    });
    assert.equal(bad.statusCode, 403);
  });

  it('rejects unsigned and wrongly signed payloads without storing anything', async () => {
    const payload = textMessage({ ...fixtureFor(tenantA), from: CUSTOMER, id: 'wamid.unsigned', text: 'hi' });
    const unsigned = await context.app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(payload),
    });
    assert.equal(unsigned.statusCode, 401);
    const wrong = await post(payload, { secret: 'attacker-secret' });
    assert.equal(wrong.statusCode, 401);
    assert.deepEqual(await ownerQuery("SELECT id FROM messages WHERE provider_message_id = 'wamid.unsigned'", []), []);
  });

  it('stores an inbound message, creates the conversation, resolves the CRM person and schedules the ready-for-reply signal', async () => {
    const id = nextId();
    const response = await post(textMessage({ ...fixtureFor(tenantA), from: CUSTOMER, id, text: 'Do you fix boilers?' }));
    assert.equal(response.statusCode, 200);
    const [message] = await ownerQuery(
      'SELECT m.tenant_id, m.direction, m.sender_type, m.body, c.state, c.crm_person_id FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.provider_message_id = $1',
      [id],
    );
    assert.equal(message.tenant_id, tenantA.tenantId);
    assert.equal(message.direction, 'inbound');
    assert.equal(message.body, 'Do you fix boilers?');
    assert.equal(message.state, 'AI_ACTIVE');
    assert.match(message.crm_person_id, /^per_/);
    const jobs = await ownerQuery("SELECT kind, run_at FROM jobs WHERE tenant_id = $1 AND kind = 'conversation.ready'", [tenantA.tenantId]);
    assert.equal(jobs.length, 1);
    // grace_minutes_closed defaults to 0 and no opening hours are set, so only the debounce applies
    assert.equal(new Date(jobs[0].run_at).getTime(), context.now.getTime() + 8_000);
    assert.equal(context.published.at(-1)?.payload.type, 'message.received');
  });

  it('applies the open-hours grace period', async () => {
    await context.database.owner.query(
      `UPDATE tenant_settings SET opening_hours = '{"mon":[["00:00","23:59"]],"tue":[["00:00","23:59"]],"wed":[["00:00","23:59"]],"thu":[["00:00","23:59"]],"fri":[["00:00","23:59"]],"sat":[["00:00","23:59"]],"sun":[["00:00","23:59"]]}' WHERE tenant_id = $1`,
      [tenantB.tenantId],
    );
    const id = nextId();
    await post(textMessage({ ...fixtureFor(tenantB), from: CUSTOMER, id, text: 'Are you open?' }));
    const [job] = await ownerQuery(
      "SELECT j.run_at FROM jobs j JOIN messages m ON j.payload->>'message_id' = m.id WHERE m.provider_message_id = $1",
      [id],
    );
    assert.equal(new Date(job.run_at).getTime(), context.now.getTime() + 2 * 60_000);
  });

  it('treats a byte-identical retry as a duplicate body', async () => {
    const raw = JSON.stringify(textMessage({ ...fixtureFor(tenantA), from: CUSTOMER, id: nextId(), text: 'retry me' }));
    assert.equal((await post(undefined, { raw })).statusCode, 200);
    const second = await post(undefined, { raw });
    assert.equal(second.statusCode, 200);
    assert.deepEqual(second.json(), { duplicate_body: true });
  });

  it('de-duplicates the same provider message id in a different body', async () => {
    const id = nextId();
    await post(textMessage({ ...fixtureFor(tenantA), from: CUSTOMER, id, text: 'one' }));
    const second = await post(textMessage({ ...fixtureFor(tenantA), from: CUSTOMER, id, text: 'one', name: 'Changed Name' }));
    assert.deepEqual(second.json().outcomes, [{ kind: 'duplicate', providerMessageId: id }]);
    assert.equal((await ownerQuery('SELECT 1 FROM messages WHERE provider_message_id = $1', [id])).length, 1);
    assert.equal((await ownerQuery("SELECT 1 FROM jobs WHERE idempotency_key LIKE 'conversation.ready:%' AND payload->>'message_id' IN (SELECT id FROM messages WHERE provider_message_id = $1)", [id])).length, 1);
  });

  it('handles concurrent duplicate deliveries with one stored message and one conversation', async () => {
    const customer = '447700900777';
    const id = nextId();
    const payloads = Array.from({ length: 5 }, (_, index) =>
      textMessage({ ...fixtureFor(tenantA), from: customer, id, text: 'same', name: `Name ${index}` }),
    );
    const responses = await Promise.all(payloads.map((payload) => post(payload)));
    assert.deepEqual(responses.map((response) => response.statusCode), [200, 200, 200, 200, 200]);
    assert.equal((await ownerQuery('SELECT 1 FROM messages WHERE provider_message_id = $1', [id])).length, 1);
    assert.equal((await ownerQuery('SELECT 1 FROM conversations WHERE customer_identity = $1', [customer])).length, 1);
  });

  it('creates one conversation for two different first messages arriving at once', async () => {
    const customer = '447700900778';
    await Promise.all([
      post(textMessage({ ...fixtureFor(tenantA), from: customer, id: nextId(), text: 'first' })),
      post(textMessage({ ...fixtureFor(tenantA), from: customer, id: nextId(), text: 'second' })),
    ]);
    assert.equal((await ownerQuery('SELECT 1 FROM conversations WHERE customer_identity = $1', [customer])).length, 1);
    assert.equal(
      (await ownerQuery('SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.customer_identity = $1', [customer])).length,
      2,
    );
  });

  it('rejects a replay of a signed body older than the retry window', async () => {
    const id = nextId();
    const stale = textMessage({ ...fixtureFor(tenantA), timestamp: new Date(context.now.getTime() - 49 * 3600_000), from: CUSTOMER, id, text: 'old' });
    const response = await post(stale);
    assert.deepEqual(response.json().outcomes, [{ kind: 'ignored', reason: 'stale_event' }]);
    const future = textMessage({ ...fixtureFor(tenantA), timestamp: new Date(context.now.getTime() + 3600_000), from: CUSTOMER, id: nextId(), text: 'later' });
    assert.deepEqual((await post(future)).json().outcomes, [{ kind: 'ignored', reason: 'event_from_the_future' }]);
    assert.equal((await ownerQuery('SELECT 1 FROM messages WHERE provider_message_id = $1', [id])).length, 0);
  });

  it('ignores unknown numbers and a phone number id paired with another tenant WABA id', async () => {
    const unknown = await post(textMessage({ wabaId: 'x', phoneNumberId: '999', timestamp: context.now, from: CUSTOMER, id: nextId(), text: 'hi' }));
    assert.deepEqual(unknown.json().outcomes, [{ kind: 'ignored', reason: 'unknown_phone_number_id' }]);
    const swapped = await post(
      textMessage({ wabaId: tenantB.wabaId, phoneNumberId: tenantA.phoneNumberId, timestamp: context.now, from: CUSTOMER, id: nextId(), text: 'hi' }),
    );
    assert.deepEqual(swapped.json().outcomes, [{ kind: 'ignored', reason: 'business_account_mismatch' }]);
  });

  it('keeps the same customer in separate conversations per tenant', async () => {
    const customer = '447700900555';
    await post(textMessage({ ...fixtureFor(tenantA), from: customer, id: nextId(), text: 'to A' }));
    await post(textMessage({ ...fixtureFor(tenantB), from: customer, id: nextId(), text: 'to B' }));
    const rows = await ownerQuery('SELECT tenant_id FROM conversations WHERE customer_identity = $1 ORDER BY tenant_id', [customer]);
    assert.deepEqual(rows.map((row) => row.tenant_id).sort(), [tenantA.tenantId, tenantB.tenantId].sort());
    const fromB = await withTenant(context.database.app, tenantB.tenantId, (client) =>
      client.query("SELECT body FROM messages WHERE sender_identity = $1 AND direction = 'inbound'", [customer]),
    );
    assert.deepEqual(fromB.rows, [{ body: 'to B' }]);
  });

  it('moves a coexistence conversation to HUMAN_ACTIVE on an echo and clears any claim', async () => {
    const customer = '447700900666';
    await post(textMessage({ ...fixtureFor(coexistence), from: customer, id: nextId(), text: 'hello' }));
    await context.database.owner.query(
      "UPDATE conversations SET claim_id = 'clm_x', claim_holder = 'ai', claim_expires_at = $2 WHERE customer_identity = $1 AND tenant_id = $3",
      [customer, new Date(context.now.getTime() + 60_000), coexistence.tenantId],
    );
    await post(messageEcho({ ...fixtureFor(coexistence), from: coexistence.businessNumber, to: customer, id: nextId(), text: 'Hi, Ali here' }));
    const [conversation] = await ownerQuery(
      'SELECT state, claim_id, ai_paused_until, last_human_reply_at FROM conversations WHERE customer_identity = $1 AND tenant_id = $2',
      [customer, coexistence.tenantId],
    );
    assert.equal(conversation.state, 'HUMAN_ACTIVE');
    assert.equal(conversation.claim_id, null);
    assert.equal(new Date(conversation.ai_paused_until).getTime(), context.now.getTime() + 4 * 3600_000);
    assert.equal(context.published.at(-1)?.payload.type, 'conversation.human_takeover');
  });

  it('ignores echoes on route B and C numbers', async () => {
    const response = await post(messageEcho({ ...fixtureFor(tenantA), from: tenantA.businessNumber, to: CUSTOMER, id: nextId(), text: 'x' }));
    assert.deepEqual(response.json().outcomes, [{ kind: 'ignored', reason: 'echo_on_non_coexistence_number' }]);
  });

  it('stores a voice note with a pending virus scan', async () => {
    const id = nextId();
    await post(voiceNote({ ...fixtureFor(tenantA), from: CUSTOMER, id }));
    const [attachment] = await ownerQuery(
      'SELECT a.type, a.mime_type, a.virus_scan_status FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.provider_message_id = $1',
      [id],
    );
    assert.deepEqual(attachment, { type: 'audio', mime_type: 'audio/ogg; codecs=opus', virus_scan_status: 'pending' });
  });

  it('records STOP as an opt-out without scheduling a ready-for-reply signal', async () => {
    const customer = '447700900444';
    const id = nextId();
    await post(textMessage({ ...fixtureFor(tenantA), from: customer, id, text: 'STOP' }));
    const [contact] = await ownerQuery('SELECT opted_out_at FROM customer_contacts WHERE tenant_id = $1 AND customer_identity = $2', [tenantA.tenantId, customer]);
    assert.notEqual(contact.opted_out_at, null);
    const jobs = await ownerQuery("SELECT 1 FROM jobs j JOIN messages m ON j.payload->>'message_id' = m.id WHERE m.provider_message_id = $1", [id]);
    assert.equal(jobs.length, 0);
  });

  it('only moves delivery status forward', async () => {
    const [conversation] = await ownerQuery('SELECT id FROM conversations WHERE tenant_id = $1 LIMIT 1', [tenantA.tenantId]);
    await context.database.owner.query(
      `INSERT INTO messages (id, tenant_id, conversation_id, provider_message_id, direction, sender_type, sender_identity, message_type, body, status)
       VALUES ('msg_outbound1', $1, $2, 'wamid.out1', 'outbound', 'ai', 'ai', 'text', 'hello', 'sent')`,
      [tenantA.tenantId, conversation.id],
    );
    await post(statusUpdate({ ...fixtureFor(tenantA), id: 'wamid.out1', status: 'read', recipient: CUSTOMER }));
    const late = await post(statusUpdate({ ...fixtureFor(tenantA), id: 'wamid.out1', status: 'delivered', recipient: CUSTOMER }));
    assert.equal(late.json().outcomes[0].updated, false);
    const [message] = await ownerQuery("SELECT status FROM messages WHERE id = 'msg_outbound1'", []);
    assert.equal(message.status, 'read');
    const crossTenant = await post(statusUpdate({ ...fixtureFor(tenantB), id: 'wamid.out1', status: 'failed', recipient: CUSTOMER }));
    assert.equal(crossTenant.json().outcomes[0].updated, false);
  });

  it('returns 400 on a signed body that is not JSON', async () => {
    const response = await post(undefined, { raw: 'not json' });
    assert.equal(response.statusCode, 400);
  });
});
