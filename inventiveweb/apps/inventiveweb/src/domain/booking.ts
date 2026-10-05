import { parseFormSchema, validateAnswers, type Answer } from '../shared/forms.ts';

export type TimeSlot = { start: Date; end: Date };
export type WorkingHours = {
  timeZone: string;
  days: Array<{
    day: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    start: string; // HH:mm
    end: string;   // HH:mm
  }>;
};

export type BookingService = {
  id: string;
  name: string;
  durationMinutes: number | null;
  bufferBeforeMinutes: number | null;
  bufferAfterMinutes: number | null;
  timeZone: string | null;
  assignedStaffIds: string[] | null;
  calendarId: string | null;
  workingHours: WorkingHours | null;
  bookingLeadTimeMinutes: number | null;
  bookingMaxDaysAhead: number | null;
  cancellationPolicy: string | null;
  description: string | null;
  formVersionId: string | null;
  isActive: boolean | null;
};

export type StaffCalendar = {
  id: string;
  personId: string;
  provider: 'GOOGLE' | 'MICROSOFT';
  providerCalendarId: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'EXPIRED';
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  expiresAt: string | null;
  isDefault: boolean;
};

export type Appointment = {
  id: string;
  serviceId: string;
  customerId: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  status: 'REQUESTED' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
  provider: 'GOOGLE' | 'MICROSOFT' | null;
  providerEventId: string | null;
  answers: Record<string, Answer>;
};

export type BookingRepository = {
  readService: (id: string) => Promise<BookingService>;
  readVersion: (id: string) => Promise<{ id: string; purpose: string; schemaJson: unknown }>;
  findDefaultCalendar: (personIds: string[]) => Promise<StaffCalendar | null>;
  getProviderEvents: (calendarId: string, from: Date, to: Date) => Promise<Array<{ start: Date; end: Date }>>;
  getExistingAppointments: (serviceId: string, from: Date, to: Date) => Promise<Appointment[]>;
  createAppointment: (appointment: Omit<Appointment, 'id'>) => Promise<Appointment>;
  updateAppointment: (id: string, patch: Partial<Appointment>) => Promise<Appointment>;
  readAppointment: (id: string) => Promise<Appointment>;
  createProviderEvent: (args: {
    calendar: StaffCalendar;
    summary: string;
    description?: string;
    start: Date;
    end: Date;
    timeZone: string;
  }) => Promise<{ eventId: string }>;
  deleteProviderEvent: (calendar: StaffCalendar, eventId: string) => Promise<void>;
};

export class BookingError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseDuration(input: unknown): number {
  const n = typeof input === 'string' ? Number(input) : input;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1 || n > 1440 || !Number.isInteger(n)) {
    throw new BookingError('Duration must be an integer number of minutes between 1 and 1440.', 400);
  }
  return n;
}

export function parseTimeZone(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) throw new BookingError('Time zone is required.', 400);
  try { Intl.DateTimeFormat(undefined, { timeZone: input }).format(new Date()); }
  catch { throw new BookingError('Invalid time zone.', 400); }
  return input;
}

export function parseDate(input: unknown): Date {
  if (typeof input !== 'string' || !input.trim()) throw new BookingError('A valid ISO date is required.', 400);
  const d = new Date(input);
  if (!Number.isFinite(d.getTime())) throw new BookingError('Invalid date.', 400);
  return d;
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  if (!h || !m) throw new BookingError('Working hours must use HH:mm format.', 400);
  const hr = Number(h), min = Number(m);
  if (!Number.isInteger(hr) || !Number.isInteger(min) || hr < 0 || hr > 23 || min < 0 || min > 59) {
    throw new BookingError('Invalid working hours.', 400);
  }
  return hr * 60 + min;
}

export function getWorkingHours(service: BookingService): WorkingHours {
  const fallback: WorkingHours = { timeZone: parseTimeZone(service.timeZone ?? 'UTC'), days: [] };
  if (!service.workingHours) return fallback;
  const input = service.workingHours;
  if (!isRecord(input) || !Array.isArray(input.days)) return fallback;
  const tz = typeof input.timeZone === 'string' ? parseTimeZone(input.timeZone) : fallback.timeZone;
  const days = input.days.map((d: unknown) => {
    if (!isRecord(d) || typeof d.day !== 'number' || typeof d.start !== 'string' || typeof d.end !== 'string') {
      throw new BookingError('Invalid working hours day.', 400);
    }
    const day = d.day as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    if (![0,1,2,3,4,5,6].includes(day)) throw new BookingError('Invalid day of week.', 400);
    const start = hhmmToMinutes(d.start);
    const end = hhmmToMinutes(d.end);
    if (start >= end) throw new BookingError('Working hours start must be before end.', 400);
    return { day, start: d.start as string, end: d.end as string };
  });
  return { timeZone: tz, days };
}

export function generateSlots(service: BookingService, from: Date, to: Date, busy: TimeSlot[]): TimeSlot[] {
  const duration = parseDuration(service.durationMinutes ?? 30);
  const bufferBefore = Math.max(0, service.bufferBeforeMinutes ?? 0);
  const bufferAfter = Math.max(0, service.bufferAfterMinutes ?? 0);
  const slotInterval = duration + bufferBefore + bufferAfter;
  const hours = getWorkingHours(service);
  const result: TimeSlot[] = [];
  const tz = hours.timeZone;
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: 'numeric', minute: 'numeric', weekday: 'short' });

  let cursor = new Date(from);
  while (cursor < to) {
    const parts = formatter.formatToParts(cursor);
    const dayName = parts.find(p => p.type === 'weekday')?.value ?? '';
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const day = dayMap[dayName];
    const rule = hours.days.find(d => d.day === day);
    if (rule) {
      const startMin = hhmmToMinutes(rule.start);
      const endMin = hhmmToMinutes(rule.end);
      const dayStart = new Date(cursor);
      dayStart.setUTCHours(0, startMin, 0, 0);
      const dayEnd = new Date(cursor);
      dayEnd.setUTCHours(0, endMin, 0, 0);
      let slotStart = dayStart;
      while (slotStart.getTime() + slotInterval * 60000 <= dayEnd.getTime()) {
        const slotEnd = new Date(slotStart.getTime() + duration * 60000);
        const blockedStart = new Date(slotStart.getTime() - bufferBefore * 60000);
        const blockedEnd = new Date(slotEnd.getTime() + bufferAfter * 60000);
        const conflict = busy.some(b => blockedStart < b.end && blockedEnd > b.start);
        if (!conflict && slotEnd <= to) result.push({ start: new Date(slotStart), end: new Date(slotEnd) });
        slotStart = new Date(slotStart.getTime() + slotInterval * 60000);
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    cursor.setUTCHours(0, 0, 0, 0);
  }
  return result;
}

export async function getAvailability(
  serviceId: string,
  from: Date,
  to: Date,
  repository: BookingRepository,
) {
  const service = await repository.readService(serviceId);
  if (!service.isActive) throw new BookingError('This service is not accepting bookings.', 400);
  if (!service.formVersionId) throw new BookingError('No published form is linked to this service.', 400);
  const lead = Math.max(0, service.bookingLeadTimeMinutes ?? 0);
  const maxDays = Math.min(365, Math.max(1, service.bookingMaxDaysAhead ?? 30));
  const now = new Date();
  const earliest = new Date(now.getTime() + lead * 60000);
  if (from < earliest) throw new BookingError(`Bookings must be at least ${lead} minutes in the future.`, 400);
  const latest = new Date(now.getTime() + maxDays * 24 * 60 * 60000);
  if (to > latest) throw new BookingError(`Bookings cannot be more than ${maxDays} days ahead.`, 400);

  const staffIds = service.assignedStaffIds ?? [];
  const calendar = staffIds.length ? await repository.findDefaultCalendar(staffIds) : null;
  const providerBusy: TimeSlot[] = calendar?.status === 'CONNECTED'
    ? await repository.getProviderEvents(calendar.id, from, to)
    : [];
  const existing = await repository.getExistingAppointments(serviceId, from, to);
  const existingBusy: TimeSlot[] = existing
    .filter(a => a.status !== 'CANCELLED')
    .map(a => ({ start: new Date(a.startsAt), end: new Date(a.endsAt) }));
  const busy = [...providerBusy, ...existingBusy];
  return { service, slots: generateSlots(service, from, to, busy) };
}

export async function bookAppointment(
  input: unknown,
  actor: { workspaceMemberId: string | null },
  repository: BookingRepository,
) {
  if (!actor.workspaceMemberId) throw new BookingError('Sign in as a workspace member to book.', 403);
  if (!isRecord(input)) throw new BookingError('Invalid booking request.', 400);
  const serviceId = typeof input.serviceId === 'string' ? input.serviceId : '';
  const slotStart = parseDate(input.slotStart);
  const customer = isRecord(input.customer) ? input.customer : {};
  const customerName = typeof customer.name === 'string' ? customer.name.trim() : '';
  const customerEmail = typeof customer.email === 'string' ? customer.email.trim() : '';
  if (!customerName || !customerEmail) throw new BookingError('Customer name and email are required.', 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) throw new BookingError('Invalid customer email.', 400);

  const service = await repository.readService(serviceId);
  if (!service.isActive || !service.formVersionId) throw new BookingError('Service is not bookable.', 400);
  const version = await repository.readVersion(service.formVersionId);
  if (version.purpose !== 'APPOINTMENT') throw new BookingError('The linked form is not for appointments.', 400);
  const schema = parseFormSchema(version.schemaJson);
  const answers = validateAnswers(schema, input.answers, 'customer');
  if (!answers.valid) throw new BookingError('Submitted answers are invalid.', 400);

  const duration = parseDuration(service.durationMinutes ?? 30);
  const slotEnd = new Date(slotStart.getTime() + duration * 60000);
  const tz = parseTimeZone(service.timeZone ?? 'UTC');
  const { slots } = await getAvailability(serviceId, new Date(slotStart.getTime() - 60000), new Date(slotEnd.getTime() + 60000), repository);
  const selected = slots.find(s => s.start.getTime() === slotStart.getTime() && s.end.getTime() === slotEnd.getTime());
  if (!selected) throw new BookingError('This time slot is no longer available.', 409);

  const staffIds = service.assignedStaffIds ?? [];
  const calendar = staffIds.length ? await repository.findDefaultCalendar(staffIds) : null;
  let provider: Appointment['provider'] = null;
  let providerEventId: string | null = null;

  // Find or create customer person is a repository concern; caller must provide customerId for this increment.
  const customerId = typeof input.customerId === 'string' ? input.customerId : '';
  if (!customerId) throw new BookingError('customerId is required for this increment.', 400);

  let appointment = await repository.createAppointment({
    serviceId, customerId,
    startsAt: slotStart.toISOString(), endsAt: slotEnd.toISOString(),
    timeZone: tz, status: 'CONFIRMED', provider, providerEventId, answers: answers.answers,
  });

  if (calendar?.status === 'CONNECTED') {
    try {
      const event = await repository.createProviderEvent({
        calendar, summary: `${service.name} — ${customerName}`,
        description: service.description ?? undefined,
        start: new Date(appointment.startsAt), end: new Date(appointment.endsAt),
        timeZone: tz,
      });
      appointment = await repository.updateAppointment(appointment.id, {
        provider: calendar.provider, providerEventId: event.eventId,
      });
    } catch (error) {
      // Compensating action: keep appointment as REQUESTED and let staff reconcile.
      appointment = await repository.updateAppointment(appointment.id, { status: 'REQUESTED' });
      throw new BookingError(`Calendar event could not be created: ${error instanceof Error ? error.message : 'provider error'}`, 502);
    }
  }
  return appointment;
}

export async function cancelAppointment(
  input: unknown,
  actor: { workspaceMemberId: string | null },
  repository: BookingRepository,
) {
  if (!actor.workspaceMemberId) throw new BookingError('Sign in as a workspace member.', 403);
  if (!isRecord(input) || typeof input.appointmentId !== 'string') throw new BookingError('Invalid cancel request.', 400);
  const appointment = await repository.readAppointment(input.appointmentId);
  if (appointment.status === 'CANCELLED') return appointment;
  if (appointment.provider && appointment.providerEventId) {
    const staffIds = (await repository.readService(appointment.serviceId)).assignedStaffIds ?? [];
    const calendar = await repository.findDefaultCalendar(staffIds);
    if (calendar) {
      try { await repository.deleteProviderEvent(calendar, appointment.providerEventId); }
      catch (error) { /* log and continue; mark cancelled locally */ }
    }
  }
  return repository.updateAppointment(appointment.id, { status: 'CANCELLED' });
}

export async function rescheduleAppointment(
  input: unknown,
  actor: { workspaceMemberId: string | null },
  repository: BookingRepository,
) {
  if (!actor.workspaceMemberId) throw new BookingError('Sign in as a workspace member.', 403);
  if (!isRecord(input) || typeof input.appointmentId !== 'string') throw new BookingError('Invalid reschedule request.', 400);
  const appointment = await repository.readAppointment(input.appointmentId);
  if (appointment.status === 'CANCELLED') throw new BookingError('Cannot reschedule a cancelled appointment.', 400);
  const newStart = parseDate(input.newSlotStart);
  const service = await repository.readService(appointment.serviceId);
  const duration = parseDuration(service.durationMinutes ?? 30);
  const newEnd = new Date(newStart.getTime() + duration * 60000);
  const tz = parseTimeZone(service.timeZone ?? 'UTC');
  const { slots } = await getAvailability(appointment.serviceId, new Date(newStart.getTime() - 60000), new Date(newEnd.getTime() + 60000), repository);
  const selected = slots.find(s => s.start.getTime() === newStart.getTime() && s.end.getTime() === newEnd.getTime());
  if (!selected) throw new BookingError('New slot is no longer available.', 409);

  if (appointment.provider && appointment.providerEventId) {
    const staffIds = service.assignedStaffIds ?? [];
    const calendar = await repository.findDefaultCalendar(staffIds);
    if (calendar?.status === 'CONNECTED') {
      try { await repository.deleteProviderEvent(calendar, appointment.providerEventId); }
      catch (error) { /* best-effort */ }
      const event = await repository.createProviderEvent({
        calendar, summary: `${service.name}`,
        description: service.description ?? undefined,
        start: newStart, end: newEnd, timeZone: tz,
      });
      return repository.updateAppointment(appointment.id, {
        startsAt: newStart.toISOString(), endsAt: newEnd.toISOString(),
        provider: calendar.provider, providerEventId: event.eventId,
      });
    }
  }
  return repository.updateAppointment(appointment.id, {
    startsAt: newStart.toISOString(), endsAt: newEnd.toISOString(),
  });
}
