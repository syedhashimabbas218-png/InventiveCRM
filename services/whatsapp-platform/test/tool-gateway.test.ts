import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { newId } from '../src/shared/ids.ts';
import { InMemoryCalendar } from '../src/stubs/in-memory-calendar.ts';
import { InMemoryCrm } from '../src/stubs/in-memory-crm.ts';
import { InMemoryEventBus } from '../src/stubs/in-memory-event-bus.ts';
import { InMemoryOwnerNotifier } from '../src/stubs/in-memory-owner-notifier.ts';
import { ToolGateway } from '../src/tools/gateway.ts';
import { createPhaseOneTools, PHASE_ONE_ALLOWLIST, type BookingChange } from '../src/tools/phase-one-tools.ts';
import { registerTool, type ToolContext, type ToolDefinition } from '../src/tools/types.ts';
import { seedTenant, type SeededTenant } from './helpers/fixtures.ts';
import { createTestDatabase, type TestDatabase } from './helpers/test-database.ts';

let database: TestDatabase;
let gateway: ToolGateway;
let calendar: InMemoryCalendar;
let crm: InMemoryCrm;
let ownerNotifier: InMemoryOwnerNotifier;
let plumber: SeededTenant;
let dentist: SeededTenant;
const bookingChanges: BookingChange[] = [];
const now = new Date('2026-11-03T10:00:00Z');
let messageSequence = 0;

const createConversation = async (tenant: SeededTenant, customer: string) => {
  const conversationId = newId('cnv');
  await database.owner.query(
    `INSERT INTO conversations (id, tenant_id, whatsapp_account_id, customer_identity, last_customer_message_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [conversationId, tenant.tenantId, tenant.whatsappAccountId, customer, now],
  );
  return conversationId;
};

const customerMessage = async (tenant: SeededTenant, conversationId: string, customer: string, receivedAt = now) => {
  const messageId = newId('msg');
  await database.owner.query(
    `INSERT INTO messages (id, tenant_id, conversation_id, provider_message_id, direction, sender_type, sender_identity, message_type, body, received_at)
     VALUES ($1, $2, $3, $4, 'inbound', 'customer', $5, 'reply', 'Confirm', $6)`,
    [messageId, tenant.tenantId, conversationId, `wamid.gw${++messageSequence}`, customer, receivedAt],
  );
  return messageId;
};

const contextFor = (tenant: SeededTenant, conversationId: string, customer: string): ToolContext => ({
  tenantId: tenant.tenantId,
  conversationId,
  customerIdentity: customer,
  crmPersonId: null,
  actor: { type: 'agent', id: 'agent' },
  correlationId: newId('cor'),
});

const auditRows = async (tenantId: string) =>
  (await database.owner.query('SELECT action, decision, details FROM audit_log WHERE tenant_id = $1 ORDER BY id', [tenantId])).rows;

describe('tool gateway', () => {
  before(async () => {
    database = await createTestDatabase();
    plumber = await seedTenant(database.owner, 'Ahmed Plumbing');
    dentist = await seedTenant(database.owner, 'Bright Dental');
    calendar = new InMemoryCalendar();
    crm = new InMemoryCrm();
    ownerNotifier = new InMemoryOwnerNotifier();
    const slots = [11, 14, 16].map((hour) => ({
      start: `2026-11-04T${hour}:00:00.000Z`,
      end: `2026-11-04T${hour + 1}:00:00.000Z`,
    }));
    calendar.setSlots(plumber.tenantId, slots);
    calendar.setSlots(dentist.tenantId, slots);

    for (const [tenant, title, body] of [
      [plumber, 'Opening hours', 'We are open Monday to Friday 8am to 6pm.'],
      [plumber, 'Service area', 'We cover Leeds and Bradford.'],
      [dentist, 'Opening hours', 'The practice is open 9am to 5pm, closed weekends.'],
    ] as const) {
      await database.owner.query('INSERT INTO kb_entries (id, tenant_id, title, body) VALUES ($1, $2, $3, $4)', [newId('kb'), tenant.tenantId, title, body]);
    }
    await database.owner.query(
      `INSERT INTO pricebook_items (id, tenant_id, name, description, price_pence, approved) VALUES
       ($1, $3, 'Boiler service', 'Annual gas boiler service', 8500, true),
       ($2, $3, 'Boiler replacement', 'New combi boiler fitted', 250000, false),
       ($4, $5, 'Check-up', 'Routine dental check-up', 4500, true)`,
      [newId('pb'), newId('pb'), plumber.tenantId, newId('pb'), dentist.tenantId],
    );

    const testOnlyTools: ToolDefinition[] = [
      registerTool({
        name: 'system.deploy',
        description: 'internal',
        permissionClass: 'internal_approval',
        parameters: {},
        parse: () => ({ ok: true, value: {} }),
        execute: async () => {
          throw new Error('must never run');
        },
      }),
      registerTool({
        name: 'refund.issue',
        description: 'financial',
        permissionClass: 'staff_approval',
        parameters: {},
        parse: () => ({ ok: true, value: {} }),
        prepare: async () => ({ ok: true, params: { amount_pence: 1000 }, summary: 'Refund £10', expiresAt: new Date(now.getTime() + 86_400_000) }),
        execute: async () => {
          throw new Error('must never run without staff');
        },
      }),
    ];
    gateway = new ToolGateway(
      { database: database.app, crm, calendar, eventBus: new InMemoryEventBus(), ownerNotifier, clock: () => now },
      [...createPhaseOneTools(async (_client, change) => void bookingChanges.push(change)), ...testOnlyTools],
      { ...PHASE_ONE_ALLOWLIST, agent: new Set([...PHASE_ONE_ALLOWLIST.agent, 'system.deploy', 'refund.issue']) },
    );
  });

  after(async () => {
    await database?.drop();
  });

  it('kb.search returns only this tenant articles and only approved prices', async () => {
    const conversationId = await createConversation(plumber, '447700900001');
    const result = await gateway.call(contextFor(plumber, conversationId, '447700900001'), 'kb.search', { query: 'opening hours boiler price' });
    assert.equal(result.status, 'ok');
    const output = result.status === 'ok' ? (result.output as { articles: { body: string }[]; prices: { item: string; price: string }[] }) : undefined;
    assert.ok(output?.articles.some((article) => article.body.includes('Monday to Friday')));
    assert.ok(!output?.articles.some((article) => article.body.includes('practice')));
    assert.deepEqual(output?.prices.map((price) => [price.item, price.price]), [['Boiler service', '£85']]);
  });

  it('rejects any attempt to pass a tenant or extra argument', async () => {
    const conversationId = await createConversation(plumber, '447700900002');
    const context = contextFor(plumber, conversationId, '447700900002');
    for (const input of [
      { query: 'hours', tenant_id: dentist.tenantId },
      { query: 'hours', conversation_id: 'cnv_other' },
      'hours',
      [{ query: 'hours' }],
    ]) {
      const result = await gateway.call(context, 'kb.search', input);
      assert.equal(result.status, 'denied', JSON.stringify(input));
    }
  });

  it('denies unknown tools and internal-approval tools, even when allow-listed', async () => {
    const conversationId = await createConversation(plumber, '447700900003');
    const context = contextFor(plumber, conversationId, '447700900003');
    assert.deepEqual(await gateway.call(context, 'sql.run', { q: 'select 1' }), { status: 'denied', reason: 'unknown_tool' });
    assert.deepEqual(await gateway.call(context, 'system.deploy', {}), { status: 'denied', reason: 'not_permitted' });
    assert.deepEqual(
      gateway.listFor('agent').map((tool) => tool.name).includes('system.deploy'),
      false,
    );
  });

  it('never runs tools for system or user actors that are not on their allow-list', async () => {
    const conversationId = await createConversation(plumber, '447700900004');
    const context = { ...contextFor(plumber, conversationId, '447700900004'), actor: { type: 'system' as const, id: 'n8n' } };
    assert.deepEqual(await gateway.call(context, 'kb.search', { query: 'x' }), { status: 'denied', reason: 'not_permitted' });
  });

  it('staff-approval tools only create a pending item and alert the owner', async () => {
    const conversationId = await createConversation(plumber, '447700900005');
    const result = await gateway.call(contextFor(plumber, conversationId, '447700900005'), 'refund.issue', {});
    assert.equal(result.status, 'needs_staff_approval');
    assert.equal(ownerNotifier.alerts.at(-1)?.message, 'Approval needed: Refund £10');
  });

  it('booking needs a slot from availability.get in the same conversation', async () => {
    const customer = '447700900006';
    const conversationId = await createConversation(plumber, customer);
    const context = contextFor(plumber, conversationId, customer);
    const invented = await gateway.call(context, 'booking.create', { slot_id: 'slot_aaaaaaaaaaaaaaaaaaaa' });
    assert.deepEqual(invented, { status: 'failed', reason: 'slot_not_offered_in_this_conversation' });

    const otherConversation = await createConversation(plumber, '447700900007');
    const offeredElsewhere = await gateway.call(contextFor(plumber, otherConversation, '447700900007'), 'availability.get', { from_date: '2026-11-04' });
    const foreignSlot = offeredElsewhere.status === 'ok' ? (offeredElsewhere.output as { slots: { slot_id: string }[] }).slots[0]?.slot_id : '';
    assert.deepEqual(await gateway.call(context, 'booking.create', { slot_id: foreignSlot }), {
      status: 'failed',
      reason: 'slot_not_offered_in_this_conversation',
    });
  });

  it('a slot id from another tenant is invisible', async () => {
    const dentistConversation = await createConversation(dentist, '447700900008');
    const offered = await gateway.call(contextFor(dentist, dentistConversation, '447700900008'), 'availability.get', { from_date: '2026-11-04' });
    const dentistSlot = offered.status === 'ok' ? (offered.output as { slots: { slot_id: string }[] }).slots[0]?.slot_id : '';
    const plumberConversation = await createConversation(plumber, '447700900008');
    const result = await gateway.call(contextFor(plumber, plumberConversation, '447700900008'), 'booking.create', { slot_id: dentistSlot });
    assert.deepEqual(result, { status: 'failed', reason: 'slot_not_offered_in_this_conversation' });
  });

  it('booking.create waits for the customer button, then books exactly once with the stored slot', async () => {
    const customer = '447700900009';
    const conversationId = await createConversation(plumber, customer);
    const context = contextFor(plumber, conversationId, customer);
    const offered = await gateway.call(context, 'availability.get', { from_date: '2026-11-04' });
    assert.equal(offered.status, 'ok');
    const slots = offered.status === 'ok' ? (offered.output as { slots: { slot_id: string; label: string }[] }).slots : [];
    assert.equal(slots.length, 3);

    const proposed = await gateway.call(context, 'booking.create', { slot_id: slots[1]?.slot_id });
    assert.equal(proposed.status, 'needs_customer_confirmation');
    if (proposed.status !== 'needs_customer_confirmation') return;
    assert.equal(proposed.confirmation.summary, 'Book Wed 4 Nov, 14:00');
    assert.equal(bookingChanges.length, 0);

    const tap = await customerMessage(plumber, conversationId, customer, new Date(now.getTime() + 1000));
    const confirmButton = proposed.confirmation.buttons[0]?.id ?? '';
    const confirmed = await gateway.resolveConfirmation(context, confirmButton, tap);
    assert.equal(confirmed?.status, 'ok');
    assert.equal(bookingChanges.length, 1);
    assert.equal(bookingChanges[0]?.startsAt.toISOString(), '2026-11-04T14:00:00.000Z');

    const again = await gateway.resolveConfirmation(context, confirmButton, tap);
    assert.deepEqual(again, { status: 'failed', reason: 'already_executed' });
    assert.equal(bookingChanges.length, 1);
  });

  it('a confirmation from a different conversation or customer is rejected', async () => {
    const customer = '447700900010';
    const conversationId = await createConversation(plumber, customer);
    const context = contextFor(plumber, conversationId, customer);
    const offered = await gateway.call(context, 'availability.get', { from_date: '2026-11-04' });
    const slotId = offered.status === 'ok' ? (offered.output as { slots: { slot_id: string }[] }).slots[0]?.slot_id : '';
    const proposed = await gateway.call(context, 'booking.create', { slot_id: slotId });
    const buttonId = proposed.status === 'needs_customer_confirmation' ? proposed.confirmation.buttons[0]?.id ?? '' : '';

    const intruder = '447700900011';
    const intruderConversation = await createConversation(plumber, intruder);
    const intruderTap = await customerMessage(plumber, intruderConversation, intruder, new Date(now.getTime() + 1000));
    const fromElsewhere = await gateway.resolveConfirmation(contextFor(plumber, intruderConversation, intruder), buttonId, intruderTap);
    assert.deepEqual(fromElsewhere, { status: 'failed', reason: 'unknown_confirmation' });

    const dentistConversation = await createConversation(dentist, customer);
    const dentistTap = await customerMessage(dentist, dentistConversation, customer, new Date(now.getTime() + 1000));
    const crossTenant = await gateway.resolveConfirmation(contextFor(dentist, dentistConversation, customer), buttonId, dentistTap);
    assert.deepEqual(crossTenant, { status: 'failed', reason: 'unknown_confirmation' });
  });

  it('cancel and reschedule only work on the customer own bookings', async () => {
    const customer = '447700900012';
    const conversationId = await createConversation(plumber, customer);
    const context = contextFor(plumber, conversationId, customer);
    const offered = await gateway.call(context, 'availability.get', { from_date: '2026-11-04' });
    const slotId = offered.status === 'ok' ? (offered.output as { slots: { slot_id: string }[] }).slots[0]?.slot_id : '';
    const proposed = await gateway.call(context, 'booking.create', { slot_id: slotId });
    const buttonId = proposed.status === 'needs_customer_confirmation' ? proposed.confirmation.buttons[0]?.id ?? '' : '';
    const booked = await gateway.resolveConfirmation(context, buttonId, await customerMessage(plumber, conversationId, customer, new Date(now.getTime() + 1000)));
    const bookingId = booked?.status === 'ok' ? (booked.output as { booking_id: string }).booking_id : '';

    const other = '447700900013';
    const otherConversation = await createConversation(plumber, other);
    assert.deepEqual(await gateway.call(contextFor(plumber, otherConversation, other), 'booking.cancel', { booking_id: bookingId }), {
      status: 'failed',
      reason: 'booking_not_found',
    });
    const cancel = await gateway.call(context, 'booking.cancel', { booking_id: bookingId });
    assert.equal(cancel.status, 'needs_customer_confirmation');
  });

  it('handoff pauses the AI for the conversation and alerts the owner', async () => {
    const conversationId = await createConversation(plumber, '447700900014');
    const result = await gateway.call(contextFor(plumber, conversationId, '447700900014'), 'handoff.request', { reason: 'complaint', summary: 'Unhappy with last visit' });
    assert.equal(result.status, 'ok');
    const row = (await database.owner.query('SELECT ai_paused_until FROM conversations WHERE id = $1', [conversationId])).rows[0];
    assert.equal(new Date(row.ai_paused_until).getTime(), now.getTime() + 4 * 3600_000);
    assert.equal(ownerNotifier.alerts.at(-1)?.kind, 'handoff');
  });

  it('crm tools only touch the person behind this conversation', async () => {
    const customer = '447700900015';
    const conversationId = await createConversation(plumber, customer);
    await gateway.call(contextFor(plumber, conversationId, customer), 'crm.add_note', { note: 'Has a Worcester boiler' });
    const person = await crm.findOrCreatePersonByPhone(plumber.tenantId, customer);
    assert.deepEqual(crm.notes.at(-1), { tenantId: plumber.tenantId, personId: person.id, note: 'Has a Worcester boiler' });
    const lookup = await gateway.call(contextFor(plumber, conversationId, customer), 'crm.find_person', { phone: '447700900001' });
    assert.equal(lookup.status, 'denied');
  });

  it('writes every call, allowed or denied, to the tenant audit log', async () => {
    const rows = await auditRows(plumber.tenantId);
    const actions = rows.map((row) => `${row.action}:${row.decision}`);
    assert.ok(actions.includes('tool:kb.search:allowed'));
    assert.ok(actions.includes('tool:kb.search:denied'));
    assert.ok(actions.includes('tool:system.deploy:denied'));
    assert.ok(actions.includes('tool:booking.create:confirmed:allowed'));
    assert.ok(actions.includes('tool:confirmation:denied'));
    assert.ok(actions.includes('tool:handoff.request:allowed'));
    const dentistRows = await auditRows(dentist.tenantId);
    assert.ok(dentistRows.every((row) => !JSON.stringify(row.details).includes(plumber.tenantId)));
  });
});
