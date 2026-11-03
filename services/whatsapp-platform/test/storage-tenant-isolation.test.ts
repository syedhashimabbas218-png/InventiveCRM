import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { withTenant } from '../src/db/pool.ts';
import { newId } from '../src/shared/ids.ts';
import { seedTenant, type SeededTenant } from './helpers/fixtures.ts';
import { createTestDatabase, type TestDatabase } from './helpers/test-database.ts';

let database: TestDatabase;
let tenantA: SeededTenant;
let tenantB: SeededTenant;
let conversationA: string;

const insertConversation = (tenant: SeededTenant, conversationId = newId('cnv'), customer = '447700900123') =>
  withTenant(database.app, tenant.tenantId, (client) =>
    client.query(
      `INSERT INTO conversations (id, tenant_id, whatsapp_account_id, customer_identity)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [conversationId, tenant.tenantId, tenant.whatsappAccountId, customer],
    ),
  );

describe('storage tenant isolation', () => {
  before(async () => {
    database = await createTestDatabase();
    tenantA = await seedTenant(database.owner, 'Ahmed Plumbing');
    tenantB = await seedTenant(database.owner, 'Bright Dental');
    conversationA = newId('cnv');
    await insertConversation(tenantA, conversationA);
  });

  after(async () => {
    await database?.drop();
  });

  it('runs the app as a role that cannot bypass RLS', async () => {
    const result = await database.app.query(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    assert.deepEqual(result.rows[0], { rolsuper: false, rolbypassrls: false });
  });

  it('returns no rows when no tenant is set', async () => {
    const result = await database.app.query('SELECT id FROM conversations');
    assert.equal(result.rowCount, 0);
  });

  it('lets a tenant read its own conversation', async () => {
    const result = await withTenant(database.app, tenantA.tenantId, (client) =>
      client.query('SELECT id FROM conversations WHERE id = $1', [conversationA]),
    );
    assert.equal(result.rowCount, 1);
  });

  it('hides another tenant conversation even when the id is known (swapped id)', async () => {
    const result = await withTenant(database.app, tenantB.tenantId, (client) =>
      client.query('SELECT id FROM conversations WHERE id = $1', [conversationA]),
    );
    assert.equal(result.rowCount, 0);
  });

  it('cannot update another tenant conversation', async () => {
    const result = await withTenant(database.app, tenantB.tenantId, (client) =>
      client.query("UPDATE conversations SET state = 'CLOSED' WHERE id = $1", [conversationA]),
    );
    assert.equal(result.rowCount, 0);
    const owner = await database.owner.query('SELECT state FROM conversations WHERE id = $1', [conversationA]);
    assert.equal(owner.rows[0].state, 'AI_ACTIVE');
  });

  it('cannot insert a row tagged with another tenant', async () => {
    await assert.rejects(
      withTenant(database.app, tenantB.tenantId, (client) =>
        client.query(
          `INSERT INTO conversations (id, tenant_id, whatsapp_account_id, customer_identity)
           VALUES ($1, $2, $3, '447700900999')`,
          [newId('cnv'), tenantA.tenantId, tenantA.whatsappAccountId],
        ),
      ),
      /row-level security/,
    );
  });

  it('cannot attach a message in its own tenant to another tenant conversation', async () => {
    await assert.rejects(
      withTenant(database.app, tenantB.tenantId, (client) =>
        client.query(
          `INSERT INTO messages (id, tenant_id, conversation_id, provider_message_id, direction, sender_type,
                                 sender_identity, message_type, body)
           VALUES ($1, $2, $3, 'wamid.x', 'inbound', 'customer', '447700900123', 'text', 'hi')`,
          [newId('msg'), tenantB.tenantId, conversationA],
        ),
      ),
      /foreign key/,
    );
  });

  it('cannot link a conversation to another tenant whatsapp account', async () => {
    await assert.rejects(
      withTenant(database.app, tenantB.tenantId, (client) =>
        client.query(
          `INSERT INTO conversations (id, tenant_id, whatsapp_account_id, customer_identity)
           VALUES ($1, $2, $3, '447700900555')`,
          [newId('cnv'), tenantB.tenantId, tenantA.whatsappAccountId],
        ),
      ),
      /foreign key/,
    );
  });

  it('cannot read another tenant settings or tokens', async () => {
    const result = await withTenant(database.app, tenantB.tenantId, (client) =>
      client.query('SELECT tenant_id FROM whatsapp_accounts UNION ALL SELECT tenant_id FROM tenant_settings'),
    );
    assert.deepEqual(
      result.rows.map((row) => row.tenant_id),
      [tenantB.tenantId, tenantB.tenantId],
    );
  });

  it('resolves the tenant from the phone number id without a tenant context', async () => {
    const result = await database.app.query('SELECT * FROM resolve_tenant_by_phone_number_id($1)', [
      tenantA.phoneNumberId,
    ]);
    assert.deepEqual(result.rows, [
      {
        tenant_id: tenantA.tenantId,
        whatsapp_account_id: tenantA.whatsappAccountId,
        waba_id: tenantA.wabaId,
        connection_route: 'B',
      },
    ]);
  });

  it('cannot create tenants or change whatsapp accounts from the app role', async () => {
    await assert.rejects(
      database.app.query("INSERT INTO tenants (id, name) VALUES ('tnt_zzzzzzzz', 'x')"),
      /permission denied/,
    );
    await assert.rejects(
      withTenant(database.app, tenantA.tenantId, (client) =>
        client.query("UPDATE whatsapp_accounts SET connection_route = 'A'"),
      ),
      /permission denied/,
    );
  });
});

describe('schema rules', () => {
  before(async () => {
    database = await createTestDatabase();
    tenantA = await seedTenant(database.owner, 'Ahmed Plumbing');
  });

  after(async () => {
    await database?.drop();
  });

  it('applies the per-client defaults from section 6.4', async () => {
    const result = await withTenant(database.app, tenantA.tenantId, (client) =>
      client.query(
        `SELECT grace_minutes_open, grace_minutes_closed, human_pause_hours,
                max_template_messages_per_customer_per_week, ai_disclosure_enabled, languages,
                customer_messages_per_hour_limit
         FROM tenant_settings WHERE tenant_id = $1`,
        [tenantA.tenantId],
      ),
    );
    assert.deepEqual(result.rows[0], {
      grace_minutes_open: 2,
      grace_minutes_closed: 0,
      human_pause_hours: 4,
      max_template_messages_per_customer_per_week: 2,
      ai_disclosure_enabled: true,
      languages: ['en'],
      customer_messages_per_hour_limit: 40,
    });
  });

  it('allows only one open conversation per customer and number', async () => {
    await insertConversation(tenantA, newId('cnv'), '447700900001');
    await assert.rejects(insertConversation(tenantA, newId('cnv'), '447700900001'), /conversations_one_open_per_customer/);
  });

  it('rejects an unknown conversation state', async () => {
    await assert.rejects(
      withTenant(database.app, tenantA.tenantId, (client) =>
        client.query("UPDATE conversations SET state = 'BOT_ONLY' WHERE tenant_id = $1", [tenantA.tenantId]),
      ),
      /check constraint/,
    );
  });

  it('de-duplicates inbound messages on the provider message id', async () => {
    const conversationId = newId('cnv');
    await insertConversation(tenantA, conversationId, '447700900002');
    const insertMessage = () =>
      withTenant(database.app, tenantA.tenantId, (client) =>
        client.query(
          `INSERT INTO messages (id, tenant_id, conversation_id, provider_message_id, direction, sender_type,
                                 sender_identity, message_type, body)
           VALUES ($1, $2, $3, 'wamid.dup', 'inbound', 'customer', '447700900002', 'text', 'hi')`,
          [newId('msg'), tenantA.tenantId, conversationId],
        ),
      );
    await insertMessage();
    await assert.rejects(insertMessage(), /messages_provider_id_unique/);
  });

  it('keeps the audit log append-only, even for the owner', async () => {
    await withTenant(database.app, tenantA.tenantId, (client) =>
      client.query(
        `INSERT INTO audit_log (tenant_id, actor_type, actor_id, correlation_id, action, decision)
         VALUES ($1, 'agent', 'agent_1', 'cor_abc12345', 'kb.search', 'allowed')`,
        [tenantA.tenantId],
      ),
    );
    await assert.rejects(database.owner.query("UPDATE audit_log SET decision = 'denied'"), /append-only/);
    await assert.rejects(database.owner.query('DELETE FROM audit_log'), /append-only/);
    await assert.rejects(
      withTenant(database.app, tenantA.tenantId, (client) => client.query('DELETE FROM audit_log')),
      /permission denied/,
    );
  });

  it('has a global AI sending kill switch row', async () => {
    const result = await database.app.query('SELECT ai_sending_enabled FROM platform_settings');
    assert.deepEqual(result.rows, [{ ai_sending_enabled: true }]);
  });
});
