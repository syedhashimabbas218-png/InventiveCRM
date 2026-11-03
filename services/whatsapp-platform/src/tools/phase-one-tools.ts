import { withTenant, type TenantClient } from '../db/pool.ts';
import type { ActorType } from '../envelope/envelope.ts';
import { loadTenantSettings, pauseAi } from '../conversations/conversation-store.ts';
import { formatPence } from '../shared/money.ts';
import { newId } from '../shared/ids.ts';
import { strictObject } from './parse.ts';
import { registerTool, ToolError, type ToolContext, type ToolDefinition, type ToolRuntime } from './types.ts';

const OFFERED_SLOT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SLOTS_OFFERED = 6;
const SLOT_ID_PATTERN = /^slot_[a-z0-9]{20}$/;
const BOOKING_ID_PATTERN = /^bkg_[a-z0-9]{20}$/;

export const formatSlotLabel = (iso: Date | string, timezone: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

const searchTerms = (query: string): string =>
  (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 12).join(' or ');

const ensurePerson = async (runtime: ToolRuntime, context: ToolContext): Promise<string> => {
  if (context.crmPersonId) return context.crmPersonId;
  const person = await runtime.crm.findOrCreatePersonByPhone(context.tenantId, context.customerIdentity);
  return person.id;
};

const findOfferedSlot = async (client: TenantClient, context: ToolContext, slotId: string, now: Date) =>
  (
    await client.query<{ id: string; starts_at: Date; ends_at: Date; service_id: string | null; expires_at: Date }>(
      `SELECT id, starts_at, ends_at, service_id, expires_at FROM offered_slots
       WHERE tenant_id = $1 AND conversation_id = $2 AND id = $3 AND expires_at > $4 AND starts_at > $4`,
      [context.tenantId, context.conversationId, slotId, now],
    )
  ).rows[0];

// A customer may only change bookings made from their own number.
const findOwnBooking = async (client: TenantClient, context: ToolContext, bookingId: string) =>
  (
    await client.query<{ id: string; calendar_booking_id: string; starts_at: Date; status: string }>(
      `SELECT b.id, b.calendar_booking_id, b.starts_at, b.status FROM bookings b
       JOIN conversations c ON c.tenant_id = b.tenant_id AND c.id = b.conversation_id
       WHERE b.tenant_id = $1 AND b.id = $2 AND c.customer_identity = $3 AND b.status = 'confirmed'`,
      [context.tenantId, bookingId, context.customerIdentity],
    )
  ).rows[0];

const publish = (runtime: ToolRuntime, context: ToolContext, type: 'booking.created' | 'booking.rescheduled' | 'booking.cancelled' | 'conversation.handoff_requested', data: Record<string, unknown>, key: string) =>
  runtime.eventBus.publish({
    tenant_id: context.tenantId,
    actor: context.actor,
    correlation_id: context.correlationId,
    idempotency_key: key,
    occurred_at: runtime.clock().toISOString(),
    payload: { type, data },
  });

export type BookingChange = {
  kind: 'created' | 'rescheduled' | 'cancelled';
  bookingId: string;
  conversationId: string;
  startsAt: Date;
};

export type BookingChangeHandler = (client: TenantClient, change: BookingChange) => Promise<void>;

const kbSearch: ToolDefinition<{ query: string }> = {
  name: 'kb.search',
  description: "Search this business's own knowledge base and approved price list. Use for any question about services, prices, hours, area or policies.",
  permissionClass: 'read',
  parameters: { type: 'object', properties: { query: { type: 'string', maxLength: 200 } }, required: ['query'] },
  parse: strictObject({ query: { type: 'string', maxLength: 200 } }),
  execute: async (runtime, context, params) => {
    const terms = searchTerms(String(params.query));
    return withTenant(runtime.database, context.tenantId, async (client) => {
      if (!terms) return { articles: [], prices: [] };
      const articles = await client.query<{ title: string; body: string }>(
        `SELECT title, body FROM kb_entries
         WHERE tenant_id = $1 AND search @@ websearch_to_tsquery('english', $2)
         ORDER BY ts_rank(search, websearch_to_tsquery('english', $2)) DESC LIMIT 5`,
        [context.tenantId, terms],
      );
      const prices = await client.query<{ name: string; description: string; price_pence: number; unit: string }>(
        `SELECT name, description, price_pence, unit FROM pricebook_items
         WHERE tenant_id = $1 AND approved AND search @@ websearch_to_tsquery('english', $2)
         ORDER BY ts_rank(search, websearch_to_tsquery('english', $2)) DESC LIMIT 8`,
        [context.tenantId, terms],
      );
      return {
        articles: articles.rows,
        prices: prices.rows.map((row) => ({ item: row.name, description: row.description, price: formatPence(row.price_pence), unit: row.unit })),
      };
    });
  },
};

const crmFindPerson: ToolDefinition<Record<string, never>> = {
  name: 'crm.find_person',
  description: 'Look up the CRM record of the customer in this conversation. It cannot look up anyone else.',
  permissionClass: 'read',
  parameters: { type: 'object', properties: {} },
  parse: strictObject({}),
  execute: async (runtime, context) => {
    const personId = await ensurePerson(runtime, context);
    const person = await runtime.crm.getPerson(context.tenantId, personId);
    return { known_customer: Boolean(person?.name), name: person?.name ?? null, summary: person?.summary ?? null };
  },
};

const crmAddNote: ToolDefinition<{ note: string }> = {
  name: 'crm.add_note',
  description: "Add a short note to this customer's CRM record (job details, preferences).",
  permissionClass: 'low_risk_write',
  parameters: { type: 'object', properties: { note: { type: 'string', maxLength: 1000 } }, required: ['note'] },
  parse: strictObject({ note: { type: 'string', maxLength: 1000 } }),
  execute: async (runtime, context, params) => {
    const personId = await ensurePerson(runtime, context);
    await runtime.crm.addNote(context.tenantId, personId, String(params.note));
    return { saved: true };
  },
};

const availabilityGet: ToolDefinition<{ from_date: string; days?: number }> = {
  name: 'availability.get',
  description: 'Get real free appointment slots from the calendar. Only offer slots returned here, using their slot_id.',
  permissionClass: 'read',
  parameters: {
    type: 'object',
    properties: { from_date: { type: 'string', description: 'YYYY-MM-DD' }, days: { type: 'integer', minimum: 1, maximum: 14 } },
    required: ['from_date'],
  },
  parse: strictObject({
    from_date: { type: 'string', maxLength: 10, pattern: /^\d{4}-\d{2}-\d{2}$/ },
    days: { type: 'integer', min: 1, max: 14, optional: true },
  }),
  execute: async (runtime, context, params) => {
    const now = runtime.clock();
    const requested = new Date(`${String(params.from_date)}T00:00:00Z`);
    if (Number.isNaN(requested.getTime())) throw new ToolError('invalid date');
    const from = requested > now ? requested : now;
    const to = new Date(from.getTime() + Number(params.days ?? 7) * 24 * 60 * 60 * 1000);
    const slots = (await runtime.calendar.getAvailability(context.tenantId, { from: from.toISOString(), to: to.toISOString() })).slice(
      0,
      MAX_SLOTS_OFFERED,
    );
    return withTenant(runtime.database, context.tenantId, async (client) => {
      const { timezone } = await loadTenantSettings(client);
      const offered = [];
      for (const slot of slots) {
        const slotId = newId('slot');
        await client.query(
          `INSERT INTO offered_slots (id, tenant_id, conversation_id, starts_at, ends_at, service_id, offered_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [slotId, context.tenantId, context.conversationId, slot.start, slot.end, slot.serviceId ?? null, now, new Date(now.getTime() + OFFERED_SLOT_TTL_MS)],
        );
        offered.push({ slot_id: slotId, label: formatSlotLabel(slot.start, timezone) });
      }
      return { slots: offered };
    });
  },
};

const bookingCreate = (onChange: BookingChangeHandler): ToolDefinition<{ slot_id: string; notes?: string }> => ({
  name: 'booking.create',
  description: 'Propose a booking for an offered slot. The customer must confirm with a button before it is made.',
  permissionClass: 'customer_confirmed',
  parameters: {
    type: 'object',
    properties: { slot_id: { type: 'string' }, notes: { type: 'string', maxLength: 500 } },
    required: ['slot_id'],
  },
  parse: strictObject({
    slot_id: { type: 'string', maxLength: 40, pattern: SLOT_ID_PATTERN },
    notes: { type: 'string', maxLength: 500, optional: true },
  }),
  prepare: async (runtime, context, input) =>
    withTenant(runtime.database, context.tenantId, async (client) => {
      const slot = await findOfferedSlot(client, context, input.slot_id, runtime.clock());
      if (!slot) return { ok: false, reason: 'slot_not_offered_in_this_conversation' };
      const { timezone } = await loadTenantSettings(client);
      return {
        ok: true,
        params: { slot_id: slot.id, starts_at: slot.starts_at.toISOString(), ends_at: slot.ends_at.toISOString(), service_id: slot.service_id, notes: input.notes ?? null },
        summary: `Book ${formatSlotLabel(slot.starts_at, timezone)}`,
        expiresAt: new Date(Math.min(slot.expires_at.getTime(), slot.starts_at.getTime())),
      };
    }),
  execute: async (runtime, context, params) => {
    const personId = await ensurePerson(runtime, context);
    const booking = await runtime.calendar
      .createBooking(context.tenantId, {
        personId,
        slot: { start: String(params.starts_at), end: String(params.ends_at), serviceId: (params.service_id as string | null) ?? undefined },
        notes: (params.notes as string | null) ?? undefined,
      })
      .catch(() => {
        throw new ToolError('slot_no_longer_available');
      });
    const now = runtime.clock();
    const bookingId = newId('bkg');
    const label = await withTenant(runtime.database, context.tenantId, async (client) => {
      await client.query(
        `INSERT INTO bookings (id, tenant_id, conversation_id, crm_person_id, calendar_booking_id, starts_at, ends_at, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', $8, $8)`,
        [bookingId, context.tenantId, context.conversationId, personId, booking.id, booking.start, booking.end, now],
      );
      await onChange(client, { kind: 'created', bookingId, conversationId: context.conversationId, startsAt: new Date(booking.start) });
      const { timezone } = await loadTenantSettings(client);
      return formatSlotLabel(booking.start, timezone);
    });
    await publish(runtime, context, 'booking.created', { booking_id: bookingId, starts_at: booking.start }, `booking.created:${bookingId}`);
    return { booked: true, booking_id: bookingId, when: label };
  },
});

const bookingReschedule = (onChange: BookingChangeHandler): ToolDefinition<{ booking_id: string; slot_id: string }> => ({
  name: 'booking.reschedule',
  description: "Propose moving the customer's own booking to an offered slot. The customer must confirm with a button.",
  permissionClass: 'customer_confirmed',
  parameters: { type: 'object', properties: { booking_id: { type: 'string' }, slot_id: { type: 'string' } }, required: ['booking_id', 'slot_id'] },
  parse: strictObject({
    booking_id: { type: 'string', maxLength: 40, pattern: BOOKING_ID_PATTERN },
    slot_id: { type: 'string', maxLength: 40, pattern: SLOT_ID_PATTERN },
  }),
  prepare: async (runtime, context, input) =>
    withTenant(runtime.database, context.tenantId, async (client) => {
      const booking = await findOwnBooking(client, context, input.booking_id);
      if (!booking) return { ok: false, reason: 'booking_not_found' };
      const slot = await findOfferedSlot(client, context, input.slot_id, runtime.clock());
      if (!slot) return { ok: false, reason: 'slot_not_offered_in_this_conversation' };
      const { timezone } = await loadTenantSettings(client);
      return {
        ok: true,
        params: { booking_id: booking.id, starts_at: slot.starts_at.toISOString(), ends_at: slot.ends_at.toISOString() },
        summary: `Move your booking from ${formatSlotLabel(booking.starts_at, timezone)} to ${formatSlotLabel(slot.starts_at, timezone)}`,
        expiresAt: new Date(Math.min(slot.expires_at.getTime(), slot.starts_at.getTime())),
      };
    }),
  execute: async (runtime, context, params) =>
    withTenant(runtime.database, context.tenantId, async (client) => {
      const booking = await findOwnBooking(client, context, String(params.booking_id));
      if (!booking) throw new ToolError('booking_not_found');
      const updated = await runtime.calendar
        .rescheduleBooking(context.tenantId, booking.calendar_booking_id, { start: String(params.starts_at), end: String(params.ends_at) })
        .catch(() => {
          throw new ToolError('slot_no_longer_available');
        });
      await client.query(
        'UPDATE bookings SET starts_at = $3, ends_at = $4, updated_at = $5 WHERE tenant_id = $1 AND id = $2',
        [context.tenantId, booking.id, updated.start, updated.end, runtime.clock()],
      );
      await onChange(client, { kind: 'rescheduled', bookingId: booking.id, conversationId: context.conversationId, startsAt: new Date(updated.start) });
      await publish(runtime, context, 'booking.rescheduled', { booking_id: booking.id, starts_at: updated.start }, `booking.rescheduled:${booking.id}:${updated.start}`);
      const { timezone } = await loadTenantSettings(client);
      return { rescheduled: true, booking_id: booking.id, when: formatSlotLabel(updated.start, timezone) };
    }),
});

const bookingCancel = (onChange: BookingChangeHandler): ToolDefinition<{ booking_id: string }> => ({
  name: 'booking.cancel',
  description: "Propose cancelling the customer's own booking. The customer must confirm with a button.",
  permissionClass: 'customer_confirmed',
  parameters: { type: 'object', properties: { booking_id: { type: 'string' } }, required: ['booking_id'] },
  parse: strictObject({ booking_id: { type: 'string', maxLength: 40, pattern: BOOKING_ID_PATTERN } }),
  prepare: async (runtime, context, input) =>
    withTenant(runtime.database, context.tenantId, async (client) => {
      const booking = await findOwnBooking(client, context, input.booking_id);
      if (!booking) return { ok: false, reason: 'booking_not_found' };
      const { timezone } = await loadTenantSettings(client);
      return {
        ok: true,
        params: { booking_id: booking.id },
        summary: `Cancel your booking on ${formatSlotLabel(booking.starts_at, timezone)}`,
        expiresAt: booking.starts_at,
      };
    }),
  execute: async (runtime, context, params) =>
    withTenant(runtime.database, context.tenantId, async (client) => {
      const booking = await findOwnBooking(client, context, String(params.booking_id));
      if (!booking) throw new ToolError('booking_not_found');
      await runtime.calendar.cancelBooking(context.tenantId, booking.calendar_booking_id);
      await client.query("UPDATE bookings SET status = 'cancelled', updated_at = $3 WHERE tenant_id = $1 AND id = $2", [
        context.tenantId,
        booking.id,
        runtime.clock(),
      ]);
      await onChange(client, { kind: 'cancelled', bookingId: booking.id, conversationId: context.conversationId, startsAt: booking.starts_at });
      await publish(runtime, context, 'booking.cancelled', { booking_id: booking.id }, `booking.cancelled:${booking.id}`);
      return { cancelled: true, booking_id: booking.id };
    }),
});

export const HANDOFF_REASONS = ['customer_asked', 'complaint', 'price_dispute', 'refund', 'emergency', 'unsure', 'other'] as const;

const handoffRequest: ToolDefinition<{ reason: string; summary: string }> = {
  name: 'handoff.request',
  description: 'Hand the conversation to a human. Use when asked, for complaints, refunds, price disputes, emergencies, or when unsure.',
  permissionClass: 'low_risk_write',
  parameters: {
    type: 'object',
    properties: { reason: { type: 'string', enum: [...HANDOFF_REASONS] }, summary: { type: 'string', maxLength: 500 } },
    required: ['reason', 'summary'],
  },
  parse: strictObject({ reason: { type: 'enum', values: HANDOFF_REASONS }, summary: { type: 'string', maxLength: 500 } }),
  execute: async (runtime, context, params) => {
    const now = runtime.clock();
    await withTenant(runtime.database, context.tenantId, async (client) => {
      const settings = await loadTenantSettings(client);
      await pauseAi(client, context.conversationId, now, new Date(now.getTime() + settings.human_pause_hours * 3600_000));
    });
    await runtime.ownerNotifier.alert({
      tenantId: context.tenantId,
      conversationId: context.conversationId,
      kind: params.reason === 'emergency' ? 'emergency' : 'handoff',
      message: `${String(params.reason)}: ${String(params.summary)}`,
    });
    await publish(runtime, context, 'conversation.handoff_requested', { conversation_id: context.conversationId, reason: params.reason }, `handoff:${context.conversationId}:${now.toISOString()}`);
    return { handed_off: true };
  },
};

export const createPhaseOneTools = (onBookingChange: BookingChangeHandler): ToolDefinition[] => [
  registerTool(kbSearch),
  registerTool(crmFindPerson),
  registerTool(crmAddNote),
  registerTool(availabilityGet),
  registerTool(bookingCreate(onBookingChange)),
  registerTool(bookingReschedule(onBookingChange)),
  registerTool(bookingCancel(onBookingChange)),
  registerTool(handoffRequest),
];

export const PHASE_ONE_ALLOWLIST: Readonly<Record<ActorType, ReadonlySet<string>>> = {
  agent: new Set([
    'kb.search',
    'crm.find_person',
    'crm.add_note',
    'availability.get',
    'booking.create',
    'booking.reschedule',
    'booking.cancel',
    'handoff.request',
  ]),
  system: new Set(),
  user: new Set(),
};
