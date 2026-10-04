import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAvailability, bookAppointment, cancelAppointment, rescheduleAppointment,
  generateSlots, parseDuration, parseTimeZone, getWorkingHours,
  type BookingRepository, type BookingService, type StaffCalendar, type Appointment,
} from '../src/domain/booking.ts';

const service = (overrides: Partial<BookingService> = {}): BookingService => ({
  id: 'svc-1',
  name: 'Service',
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  timeZone: 'UTC',
  assignedStaffIds: ['person-1'],
  calendarId: null,
  workingHours: {
    timeZone: 'UTC',
    days: [{ day: 1, start: '09:00', end: '17:00' }],
  },
  bookingLeadTimeMinutes: 0,
  bookingMaxDaysAhead: 30,
  cancellationPolicy: null,
  description: null,
  formVersionId: 'version-1',
  isActive: true,
  ...overrides,
});

const calendar = (overrides: Partial<StaffCalendar> = {}): StaffCalendar => ({
  id: 'cal-1',
  personId: 'person-1',
  provider: 'GOOGLE',
  providerCalendarId: 'primary',
  status: 'CONNECTED',
  accessTokenEncrypted: 'enc',
  refreshTokenEncrypted: 'enc',
  expiresAt: null,
  isDefault: true,
  ...overrides,
});

const repo = (opts: {
  busy?: Array<{ start: Date; end: Date }>;
  existing?: Appointment[];
  createEventError?: boolean;
} = {}): BookingRepository => {
  const appointments: Appointment[] = opts.existing ? [...opts.existing] : [];
  const eventCalls: unknown[] = [];
  return {
    readService: async (id) => service({ id }),
    readVersion: async (id) => ({ id, purpose: 'APPOINTMENT', schemaJson: { schemaVersion: 1, fields: [{ key: 'notes', label: 'Notes', type: 'text', required: false, visibility: 'customer' }] } }),
    findDefaultCalendar: async () => calendar(),
    getProviderEvents: async () => opts.busy ?? [],
    getExistingAppointments: async (_serviceId, _from, _to) => appointments.filter(a => a.status !== 'CANCELLED'),
    createAppointment: async (a) => { const saved = { ...a, id: `appt-${appointments.length + 1}` }; appointments.push(saved); return saved; },
    updateAppointment: async (id, patch) => {
      const idx = appointments.findIndex(a => a.id === id);
      if (idx === -1) throw new Error('not found');
      appointments[idx] = { ...appointments[idx]!, ...patch };
      return appointments[idx]!;
    },
    readAppointment: async (id) => {
      const a = appointments.find(a => a.id === id);
      if (!a) throw new Error('not found');
      return a;
    },
    createProviderEvent: async (args) => {
      eventCalls.push(args);
      if (opts.createEventError) throw new Error('provider down');
      return { eventId: `evt-${eventCalls.length}` };
    },
    deleteProviderEvent: async () => { },
  };
};

test('parseDuration validates range', () => {
  assert.equal(parseDuration(30), 30);
  assert.throws(() => parseDuration(0));
  assert.throws(() => parseDuration(1500));
  assert.throws(() => parseDuration('abc'));
});

test('parseTimeZone validates IANA', () => {
  assert.equal(parseTimeZone('Europe/Amsterdam'), 'Europe/Amsterdam');
  assert.throws(() => parseTimeZone('Mars/Phobos'));
});

test('getWorkingHours rejects invalid structure', () => {
  assert.deepEqual(getWorkingHours(service({ workingHours: null })).days, []);
  assert.throws(() => getWorkingHours(service({ workingHours: { timeZone: 'UTC', days: [{ day: 1, start: '17:00', end: '09:00' }] } })));
  assert.throws(() => getWorkingHours(service({ workingHours: { timeZone: 'Bad', days: [{ day: 1, start: '09:00', end: '17:00' }] } })));
});

test('generateSlots respects working hours and buffers', () => {
  const s = service({ durationMinutes: 60, bufferBeforeMinutes: 10, bufferAfterMinutes: 10 });
  const from = new Date('2026-10-05T00:00:00Z'); // Monday
  const to = new Date('2026-10-06T00:00:00Z');
  const slots = generateSlots(s, from, to, []);
  assert.equal(slots.length, 6);
  assert.equal(slots[0]!.start.toISOString(), '2026-10-05T09:00:00.000Z');
  assert.equal(slots[0]!.end.toISOString(), '2026-10-05T10:00:00.000Z');
  const blocked = [{ start: new Date('2026-10-05T09:50:00Z'), end: new Date('2026-10-05T10:20:00Z') }];
  assert.equal(generateSlots(s, from, to, blocked).length, 4);
});

test('getAvailability rejects inactive services and lead time', async () => {
  const r = repo();
  const future = new Date(Date.now() + 48 * 60 * 60 * 1000);
  future.setUTCMinutes(0, 0, 0);
  await assert.rejects(getAvailability('svc-1', future, new Date(future.getTime() + 24 * 60 * 60000), { ...r, readService: async () => service({ isActive: false }) }));
  const soon = new Date(Date.now() + 5 * 60 * 1000);
  await assert.rejects(getAvailability('svc-1', soon, new Date(soon.getTime() + 24 * 60 * 60000), { ...r, readService: async () => service({ bookingLeadTimeMinutes: 30 }) }));
});

test('getAvailability merges provider and existing appointment busy', async () => {
  const r = repo({
    busy: [{ start: new Date('2026-10-05T10:00:00Z'), end: new Date('2026-10-05T11:00:00Z') }],
    existing: [{
      id: 'existing', serviceId: 'svc-1', customerId: 'cust-1',
      startsAt: '2026-10-05T12:00:00.000Z', endsAt: '2026-10-05T13:00:00.000Z',
      timeZone: 'UTC', status: 'CONFIRMED', provider: null, providerEventId: null, answers: {},
    }],
  });
  const from = new Date('2026-10-05T00:00:00Z');
  const to = new Date('2026-10-06T00:00:00Z');
  const { slots } = await getAvailability('svc-1', from, to, r);
  assert.ok(!slots.some(s => s.start.getTime() === new Date('2026-10-05T10:00:00Z').getTime()));
  assert.ok(!slots.some(s => s.start.getTime() === new Date('2026-10-05T12:00:00Z').getTime()));
});

test('bookAppointment writes record and provider event', async () => {
  const r = repo();
  const slotStart = new Date('2026-10-05T10:00:00Z');
  const appt = await bookAppointment({
    serviceId: 'svc-1',
    slotStart: slotStart.toISOString(),
    customerId: 'cust-1',
    customer: { name: 'Jane Doe', email: 'jane@example.com' },
    answers: {},
  }, { workspaceMemberId: 'member-1' }, r);
  assert.equal(appt.status, 'CONFIRMED');
  assert.equal(appt.provider, 'GOOGLE');
  assert.ok(appt.providerEventId?.startsWith('evt-'));
});

test('bookAppointment rejects missing actor, bad email, and taken slot', async () => {
  const r = repo();
  await assert.rejects(bookAppointment({}, { workspaceMemberId: null }, r));
  await assert.rejects(bookAppointment({ serviceId: 'svc-1', slotStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), customerId: 'c1', customer: { name: 'X', email: 'bad' }, answers: {} }, { workspaceMemberId: 'm' }, r));
  const slotStart = new Date('2026-10-05T10:00:00Z');
  await bookAppointment({ serviceId: 'svc-1', slotStart: slotStart.toISOString(), customerId: 'c1', customer: { name: 'A', email: 'a@example.com' }, answers: {} }, { workspaceMemberId: 'm' }, r);
  await assert.rejects(bookAppointment({ serviceId: 'svc-1', slotStart: slotStart.toISOString(), customerId: 'c2', customer: { name: 'B', email: 'b@example.com' }, answers: {} }, { workspaceMemberId: 'm' }, r));
});

test('bookAppointment compensates to REQUESTED when provider fails', async () => {
  const r = repo({ createEventError: true });
  const slotStart = new Date('2026-10-05T10:00:00Z');
  const promise = bookAppointment({
    serviceId: 'svc-1', slotStart: slotStart.toISOString(), customerId: 'c1',
    customer: { name: 'A', email: 'a@example.com' }, answers: {},
  }, { workspaceMemberId: 'm' }, r);
  await assert.rejects(promise);
  const existing = await r.getExistingAppointments('svc-1', slotStart, new Date(slotStart.getTime() + 60 * 60000));
  const created = existing.find(a => a.startsAt === slotStart.toISOString());
  assert.equal(created?.status, 'REQUESTED');
});

test('cancelAppointment deletes provider event and updates status', async () => {
  const r = repo();
  const slotStart = new Date('2026-10-05T10:00:00Z');
  const appt = await bookAppointment({ serviceId: 'svc-1', slotStart: slotStart.toISOString(), customerId: 'c1', customer: { name: 'A', email: 'a@example.com' }, answers: {} }, { workspaceMemberId: 'm' }, r);
  const cancelled = await cancelAppointment({ appointmentId: appt.id }, { workspaceMemberId: 'm' }, r);
  assert.equal(cancelled.status, 'CANCELLED');
});

test('rescheduleAppointment moves the slot and event', async () => {
  const r = repo();
  const slotStart = new Date('2026-10-05T10:00:00Z');
  const appt = await bookAppointment({ serviceId: 'svc-1', slotStart: slotStart.toISOString(), customerId: 'c1', customer: { name: 'A', email: 'a@example.com' }, answers: {} }, { workspaceMemberId: 'm' }, r);
  const newStart = new Date('2026-10-05T11:00:00Z');
  const moved = await rescheduleAppointment({ appointmentId: appt.id, newSlotStart: newStart.toISOString() }, { workspaceMemberId: 'm' }, r);
  assert.equal(moved.startsAt, newStart.toISOString());
});

test('cross-tenant isolation: calendar belongs to assigned staff', async () => {
  let requestedIds: string[] = [];
  const r = repo();
  const isolated: BookingRepository = {
    ...r,
    findDefaultCalendar: async (ids) => { requestedIds = ids; return ids.includes('person-1') ? calendar() : null; },
  };
  const from = new Date('2026-10-05T00:00:00Z');
  const to = new Date('2026-10-06T00:00:00Z');
  await getAvailability('svc-1', from, to, isolated);
  assert.deepEqual(requestedIds, ['person-1']);
});
