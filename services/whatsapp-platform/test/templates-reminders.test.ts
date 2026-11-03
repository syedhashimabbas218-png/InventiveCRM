import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { withTenant } from '../src/db/pool.ts';
import { newId } from '../src/shared/ids.ts';
import { TEMPLATE_LIBRARY, validateTemplateDefinition } from '../src/templates/library.ts';
import { templatePolicy } from '../src/templates/template-policy.ts';
import { customerServiceWindow } from '../src/whatsapp/window.ts';
import { createBookingChangeHandler } from '../src/reminders/booking-reminders.ts';
import { createApiClient } from './helpers/api-client.ts';
import type { SeededTenant } from './helpers/fixtures.ts';
import { createTestContext, type TestContext } from './helpers/test-context.ts';

describe('template library', () => {
  it('has every template from plan section 8.3 and each fits Meta limits', () => {
    assert.deepEqual(TEMPLATE_LIBRARY.map((template) => template.name), [
      'appointment_confirmation',
      'appointment_reminder_24h',
      'appointment_reminder_2h',
      'quote_ready',
      'quote_followup',
      'invoice_ready',
      'invoice_reminder',
      'review_request',
      'noshow_rebook',
      'reactivation',
    ]);
    for (const template of TEMPLATE_LIBRARY) assert.deepEqual(validateTemplateDefinition(template), [], template.name);
  });

  it('catches definitions Meta would reject', () => {
    const base = TEMPLATE_LIBRARY[1]!;
    assert.ok(validateTemplateDefinition({ ...base, body: 'Hi {{1}}', parameters: ['1'] }).length > 0);
    assert.ok(validateTemplateDefinition({ ...base, quick_replies: ['Confirm & pay now!'] }).length > 0);
    assert.ok(validateTemplateDefinition({ ...base, parameters: ['time', 'date', 'business_name'] }).length > 0);
  });

  it('only marks reactivation as marketing', () => {
    assert.deepEqual(TEMPLATE_LIBRARY.filter((template) => template.category === 'marketing').map((template) => template.name), ['reactivation']);
  });
});

describe('24-hour customer service window', () => {
  const at = new Date('2026-11-03T10:00:00Z');
  it('is open for 24 hours after the last customer message and closed otherwise', () => {
    assert.deepEqual(customerServiceWindow(at, new Date('2026-11-04T09:59:59Z')), { open: true, closesAt: new Date('2026-11-04T10:00:00Z') });
    assert.equal(customerServiceWindow(at, new Date('2026-11-04T10:00:00Z')).open, false);
    assert.deepEqual(customerServiceWindow(null, at), { open: false, closesAt: null });
  });
});

let context: TestContext;
let api: ReturnType<typeof createApiClient>;
let salon: SeededTenant;
let customerSequence = 0;
const newCustomer = () => `4477006${String(10000 + ++customerSequence)}`;

const approveTemplates = async (tenant: SeededTenant) => {
  for (const name of ['appointment_confirmation', 'appointment_reminder_24h', 'appointment_reminder_2h']) {
    await context.database.owner.query(
      "INSERT INTO whatsapp_templates (tenant_id, name, language, status, category) VALUES ($1, $2, 'en_GB', 'approved', 'utility')",
      [tenant.tenantId, name],
    );
  }
};

const claimFor = async (tenant: SeededTenant, conversationId: string) => {
  const latest = (
    await context.database.owner.query("SELECT id FROM messages WHERE conversation_id = $1 AND direction = 'inbound' ORDER BY seq DESC LIMIT 1", [conversationId])
  ).rows[0];
  return (await api.claim(tenant, conversationId, latest?.id ?? null)).json().claim_id as string;
};

const sendTemplate = (tenant: SeededTenant, conversationId: string, claimId: string, template: Record<string, unknown>) =>
  api.call('/v1/messages/send', tenant.apiToken, api.envelope(tenant.tenantId, { type: 'system', id: 'n8n' }, { conversation_id: conversationId, claim_id: claimId, type: 'template', template }));

const reminderTemplate = (overrides: Record<string, unknown> = {}) => ({
  name: 'appointment_reminder_24h',
  language_code: 'en_GB',
  parameters: { business_name: 'Glow Salon', date: 'Thursday 5 November', time: '10:00' },
  quick_reply_payloads: ['reminder_confirm:x', 'reminder_reschedule:x'],
  ...overrides,
});

// Inserts a booking the way booking.create does, then runs the booking-change hook.
const book = async (tenant: SeededTenant, conversationId: string, startsAt: Date) => {
  const bookingId = newId('bkg');
  await withTenant(context.database.app, tenant.tenantId, async (client) => {
    await client.query(
      `INSERT INTO bookings (id, tenant_id, conversation_id, crm_person_id, calendar_booking_id, starts_at, ends_at, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'per_x', $4, $5, $6, 'confirmed', $7, $7)`,
      [bookingId, tenant.tenantId, conversationId, `cal_${bookingId}`, startsAt, new Date(startsAt.getTime() + 3600_000), context.now],
    );
    await createBookingChangeHandler(() => context.now)(client, { kind: 'created', bookingId, conversationId, startsAt });
  });
  return bookingId;
};

const reminderJobs = async (bookingId: string) =>
  (await context.database.owner.query("SELECT payload->>'template' AS template, run_at, status FROM jobs WHERE payload->>'booking_id' = $1 ORDER BY run_at", [bookingId])).rows;

describe('template sends and reminders', () => {
  before(async () => {
    context = await createTestContext({ templatePolicy, withReminders: true });
    api = createApiClient(context);
    salon = await context.seedTenant('Glow Salon');
    await approveTemplates(salon);
  });

  after(async () => {
    await context?.close();
  });

  it('sends an approved template outside the window with named parameters, but refuses free-form text', async () => {
    const { conversationId } = await api.customerSays(salon, newCustomer(), 'hi');
    context.advance(25 * 3600_000);
    const claimId = await claimFor(salon, conversationId);
    assert.deepEqual((await api.aiSend(salon, conversationId, claimId, 'free text')).json(), { reason: 'outside_window' });
    const sent = await sendTemplate(salon, conversationId, claimId, reminderTemplate());
    assert.equal(sent.statusCode, 200, sent.body);
    const body = context.mockGraph.sends.at(-1)?.body as { template: { name: string; language: { code: string }; components: { type: string; parameters: unknown[] }[] } };
    assert.equal(body.template.name, 'appointment_reminder_24h');
    assert.deepEqual(body.template.components[0], {
      type: 'body',
      parameters: [
        { type: 'text', parameter_name: 'business_name', text: 'Glow Salon' },
        { type: 'text', parameter_name: 'date', text: 'Thursday 5 November' },
        { type: 'text', parameter_name: 'time', text: '10:00' },
      ],
    });
  });

  it('refuses templates that are unknown, from a later phase, unapproved for this number, or badly filled', async () => {
    const { conversationId } = await api.customerSays(salon, newCustomer(), 'hi');
    context.advance(10_000);
    const claimId = await claimFor(salon, conversationId);
    for (const template of [
      reminderTemplate({ name: 'made_up' }),
      reminderTemplate({ name: 'quote_ready', parameters: { business_name: 'x' }, quick_reply_payloads: [] }),
      reminderTemplate({ parameters: { business_name: 'Glow Salon' } }),
      reminderTemplate({ parameters: { business_name: 'Glow\nSalon', date: 'x', time: 'y' } }),
      reminderTemplate({ quick_reply_payloads: [] }),
    ]) {
      const response = await sendTemplate(salon, conversationId, claimId, template);
      assert.equal(response.statusCode, 422, JSON.stringify(template));
    }
    const other = await context.seedTenant('Unapproved Barber');
    const otherConversation = await api.customerSays(other, newCustomer(), 'hi');
    context.advance(10_000);
    const otherClaim = await claimFor(other, otherConversation.conversationId);
    assert.deepEqual((await sendTemplate(other, otherConversation.conversationId, otherClaim, reminderTemplate())).json().errors, ['template is not approved for this number']);
  });

  it('respects opt-out and the weekly per-customer template cap', async () => {
    const customer = newCustomer();
    const { conversationId } = await api.customerSays(salon, customer, 'hi');
    context.advance(10_000);
    let claimId = await claimFor(salon, conversationId);
    assert.equal((await sendTemplate(salon, conversationId, claimId, reminderTemplate())).statusCode, 200);
    assert.equal((await sendTemplate(salon, conversationId, claimId, reminderTemplate())).statusCode, 200);
    assert.deepEqual((await sendTemplate(salon, conversationId, claimId, reminderTemplate())).json(), { reason: 'template_cap_reached' });
    context.advance(7 * 24 * 3600_000);
    await api.customerSays(salon, customer, 'STOP');
    context.advance(10_000);
    claimId = await claimFor(salon, conversationId);
    assert.deepEqual((await sendTemplate(salon, conversationId, claimId, reminderTemplate())).json(), { reason: 'opted_out' });
  });

  it('schedules 24h and 2h reminders when a booking is made, and none in the past', async () => {
    const { conversationId } = await api.customerSays(salon, newCustomer(), 'book me in');
    const soon = await book(salon, conversationId, new Date(context.now.getTime() + 5 * 3600_000));
    assert.deepEqual((await reminderJobs(soon)).map((job) => job.template), ['appointment_reminder_2h']);
    const later = await book(salon, conversationId, new Date(context.now.getTime() + 3 * 24 * 3600_000));
    const jobs = await reminderJobs(later);
    assert.deepEqual(jobs.map((job) => job.template), ['appointment_reminder_24h', 'appointment_reminder_2h']);
    assert.equal(new Date(jobs[0].run_at).getTime(), context.now.getTime() + 2 * 24 * 3600_000);
  });

  it('sends the reminder as a template when the window is closed and as buttons when it is open', async () => {
    const customer = newCustomer();
    const { conversationId } = await api.customerSays(salon, customer, 'thanks');
    const startsAt = new Date(context.now.getTime() + 3 * 24 * 3600_000);
    const bookingId = await book(salon, conversationId, startsAt);

    context.setNow(new Date(startsAt.getTime() - 24 * 3600_000));
    await context.runJobs();
    const reminder = context.mockGraph.sends.at(-1)?.body as { type: string; to: string; template: { components: { type: string; sub_type?: string; parameters: { payload?: string }[] }[] } };
    assert.equal(reminder.type, 'template');
    assert.equal(reminder.to, customer);
    assert.deepEqual(
      reminder.template.components.filter((component) => component.type === 'button').map((component) => component.parameters[0]?.payload),
      [`reminder_confirm:${bookingId}`, `reminder_reschedule:${bookingId}`],
    );

    await api.customerSays(salon, customer, 'Thanks, see you then');
    context.setNow(new Date(startsAt.getTime() - 2 * 3600_000));
    await context.runJobs();
    const inWindow = context.mockGraph.sends.at(-1)?.body as { type: string; interactive: { body: { text: string } } };
    assert.equal(inWindow.type, 'interactive');
    assert.match(inWindow.interactive.body.text, /today at/);
  });

  it('stops reminders when the booking is cancelled, moved, or a human has taken over', async () => {
    const customer = newCustomer();
    const { conversationId } = await api.customerSays(salon, customer, 'hello');
    const startsAt = new Date(context.now.getTime() + 3 * 24 * 3600_000);
    const cancelled = await book(salon, conversationId, startsAt);
    await withTenant(context.database.app, salon.tenantId, async (client) => {
      await client.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [cancelled]);
      await createBookingChangeHandler(() => context.now)(client, { kind: 'cancelled', bookingId: cancelled, conversationId, startsAt });
    });
    assert.deepEqual((await reminderJobs(cancelled)).map((job) => job.status), ['cancelled', 'cancelled']);

    const moved = await book(salon, conversationId, startsAt);
    const newStart = new Date(startsAt.getTime() + 24 * 3600_000);
    await withTenant(context.database.app, salon.tenantId, async (client) => {
      await client.query('UPDATE bookings SET starts_at = $2 WHERE id = $1', [moved, newStart]);
      await createBookingChangeHandler(() => context.now)(client, { kind: 'rescheduled', bookingId: moved, conversationId, startsAt: newStart });
    });
    const movedJobs = await reminderJobs(moved);
    assert.deepEqual(movedJobs.map((job) => job.status), ['cancelled', 'cancelled', 'queued', 'queued']);

    await api.humanSend(salon, conversationId, 'Owner here, I will handle this');
    const sentTo = (who: string) => context.mockGraph.sends.filter((send) => send.body.to === who && send.body.type !== 'text').length;
    context.setNow(new Date(newStart.getTime() - 2 * 3600_000));
    await context.runJobs();
    // The owner's 4h pause expired days ago; the overdue 24h reminder is dropped, the 2h one goes out.
    assert.equal(sentTo(customer), 1);

    const heldCustomer = newCustomer();
    const held = await api.customerSays(salon, heldCustomer, 'hi');
    const heldBooking = await book(salon, held.conversationId, new Date(context.now.getTime() + 25 * 3600_000));
    context.advance(30 * 60_000);
    await api.humanSend(salon, held.conversationId, 'Owner here');
    context.advance(60 * 60_000);
    await context.runJobs();
    assert.equal(sentTo(heldCustomer), 0);
    assert.equal((await reminderJobs(heldBooking))[0]?.status, 'done');
  });

  it('a reminder job that runs twice sends once', async () => {
    const { conversationId } = await api.customerSays(salon, newCustomer(), 'hello');
    const startsAt = new Date(context.now.getTime() + 3 * 24 * 3600_000);
    const bookingId = await book(salon, conversationId, startsAt);
    context.setNow(new Date(startsAt.getTime() - 24 * 3600_000));
    await context.runJobs();
    const before = context.mockGraph.sends.length;
    await context.database.owner.query("UPDATE jobs SET status = 'queued' WHERE payload->>'booking_id' = $1 AND payload->>'template' = 'appointment_reminder_24h'", [bookingId]);
    await context.runJobs();
    assert.equal(context.mockGraph.sends.length, before);
  });
});
