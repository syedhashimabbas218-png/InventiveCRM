import { withTenant, type TenantClient } from '../db/pool.ts';
import { claimConversation, releaseClaim } from '../conversations/claim.ts';
import { findOrCreateOpenConversation, loadTenantSettings } from '../conversations/conversation-store.ts';
import { sendMessage, type SendDependencies } from '../conversations/send.ts';
import { enqueueJob } from '../jobs/queue.ts';
import type { DequeuedJob, JobHandler } from '../jobs/worker.ts';
import { newId } from '../shared/ids.ts';
import type { BookingChangeHandler } from '../tools/phase-one-tools.ts';
import { customerServiceWindow } from '../whatsapp/window.ts';
import { findTemplate, renderTemplate } from '../templates/library.ts';

const REMINDERS = [
  { template: 'appointment_reminder_24h', beforeMs: 24 * 3600_000 },
  { template: 'appointment_reminder_2h', beforeMs: 2 * 3600_000 },
] as const;
const TEMPLATE_LANGUAGE = 'en_GB';
// A reminder this close to the start, or this late, is more confusing than useful, so it is dropped.
const LATEST_USEFUL_BEFORE_START_MS = 30 * 60_000;
const MAX_LATENESS_MS = 60 * 60_000;
const ACTOR = { type: 'system' as const, id: 'reminders' };

const cancelQueuedReminders = (client: TenantClient, bookingId: string) =>
  client.query(
    "UPDATE jobs SET status = 'cancelled' WHERE tenant_id = $1 AND kind = 'reminder.send' AND status = 'queued' AND payload->>'booking_id' = $2",
    [client.tenantId, bookingId],
  );

export const createBookingChangeHandler =
  (clock: () => Date): BookingChangeHandler =>
  async (client, change) => {
    await cancelQueuedReminders(client, change.bookingId);
    if (change.kind === 'cancelled') return;
    const now = clock();
    for (const reminder of REMINDERS) {
      const runAt = new Date(change.startsAt.getTime() - reminder.beforeMs);
      if (runAt <= now) continue;
      await enqueueJob(client, {
        kind: 'reminder.send',
        payload: { booking_id: change.bookingId, template: reminder.template, starts_at: change.startsAt.toISOString() },
        idempotencyKey: `reminder:${change.bookingId}:${reminder.template}:${change.startsAt.toISOString()}`,
        runAt,
      });
    }
  };

const formatPart = (date: Date, timezone: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: timezone, ...options }).format(date);

export type ReminderOutcome = 'sent' | 'stopped' | 'retry';

export const createReminderHandler = (deps: SendDependencies): JobHandler => async (job: DequeuedJob) => {
  const now = deps.clock();
  const tenantId = job.tenant_id;
  const bookingId = String(job.payload.booking_id);
  const templateName = String(job.payload.template);
  const scheduledStart = String(job.payload.starts_at);
  const template = findTemplate(templateName, TEMPLATE_LANGUAGE);
  const schedule = REMINDERS.find((reminder) => reminder.template === templateName);
  if (!template || !schedule) return;
  if (now.getTime() - (new Date(scheduledStart).getTime() - schedule.beforeMs) > MAX_LATENESS_MS) return;

  const target = await withTenant(deps.database, tenantId, async (client) => {
    const booking = (
      await client.query<{ status: string; starts_at: Date; conversation_id: string }>(
        'SELECT status, starts_at, conversation_id FROM bookings WHERE tenant_id = $1 AND id = $2',
        [tenantId, bookingId],
      )
    ).rows[0];
    // Stop conditions: cancelled, moved (a new job exists for the new time), or too late to help.
    if (!booking || booking.status !== 'confirmed' || booking.starts_at.toISOString() !== scheduledStart) return undefined;
    if (booking.starts_at.getTime() - now.getTime() < LATEST_USEFUL_BEFORE_START_MS) return undefined;

    const original = (
      await client.query<{ whatsapp_account_id: string; customer_identity: string }>(
        'SELECT whatsapp_account_id, customer_identity FROM conversations WHERE tenant_id = $1 AND id = $2',
        [tenantId, booking.conversation_id],
      )
    ).rows[0];
    if (!original) return undefined;
    const conversation = await findOrCreateOpenConversation(client, original.whatsapp_account_id, original.customer_identity, now);
    const contact = (
      await client.query<{ opted_out_at: Date | null }>(
        'SELECT opted_out_at FROM customer_contacts WHERE tenant_id = $1 AND customer_identity = $2',
        [tenantId, original.customer_identity],
      )
    ).rows[0];
    if (contact?.opted_out_at) return undefined;

    const latest = (
      await client.query<{ id: string }>(
        "SELECT id FROM messages WHERE tenant_id = $1 AND conversation_id = $2 AND direction = 'inbound' ORDER BY seq DESC LIMIT 1",
        [tenantId, conversation.id],
      )
    ).rows[0];
    const settings = await loadTenantSettings(client);
    const business = (await client.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [tenantId])).rows[0];
    return {
      conversationId: conversation.id,
      latestMessageId: latest?.id ?? null,
      windowOpen: customerServiceWindow(conversation.last_customer_message_at, now).open,
      startsAt: booking.starts_at,
      timezone: settings.timezone,
      businessName: business?.name ?? '',
    };
  });
  if (!target) return;

  const claim = await claimConversation(deps, tenantId, {
    conversationId: target.conversationId,
    claimant: 'ai',
    latestMessageId: target.latestMessageId,
    ttlSeconds: 60,
  });
  if (!claim.claimed) {
    if (claim.reason === 'human_active' || claim.reason === 'not_found') return;
    // Grace period, another run, or a message that just arrived: try again shortly.
    return { retryAt: new Date(now.getTime() + 60_000) };
  }

  try {
    const parameters: Record<string, string> = {
      business_name: target.businessName,
      date: formatPart(target.startsAt, target.timezone, { weekday: 'long', day: 'numeric', month: 'long' }),
      time: formatPart(target.startsAt, target.timezone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    };
    const usedParameters = Object.fromEntries(template.parameters.map((name) => [name, parameters[name] ?? '']));
    const buttonPayloads = template.quick_replies.map((label) => `reminder_${label.toLowerCase()}:${bookingId}`);
    // Inside the window a normal message with buttons does the job, costs nothing extra and skips the template cap.
    const payload = target.windowOpen
      ? {
          type: 'buttons',
          body: renderTemplate(template, usedParameters),
          buttons: template.quick_replies.map((label, index) => ({ id: buttonPayloads[index] ?? '', title: label })),
        }
      : {
          type: 'template',
          template: { name: template.name, language_code: template.language, parameters: usedParameters, quick_reply_payloads: buttonPayloads },
        };
    await sendMessage(deps, {
      tenant_id: tenantId,
      actor: ACTOR,
      correlation_id: newId('cor'),
      idempotency_key: `reminder:${bookingId}:${templateName}:${scheduledStart}`,
      occurred_at: now.toISOString(),
      payload: { conversation_id: target.conversationId, claim_id: claim.claimId, ...payload },
    });
  } finally {
    await releaseClaim(deps, tenantId, target.conversationId, claim.claimId);
  }
};
