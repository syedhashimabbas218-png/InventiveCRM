import { type AppointmentStatus } from 'src/constants/enums';
import { type AssignmentCandidate, pickAdvisor, type RoundRobinStrategy } from 'src/engine/assignment';
import { heldInterval } from 'src/engine/availability';
import { reservationKeys, seatKey } from 'src/engine/slots';
import { DAY, MINUTE } from 'src/engine/time';
import { gql, nodes } from 'src/lib/api';
import { type AdvisorAvailability, appointmentsFor, type CustomerLocation, searchAvailability } from 'src/lib/availability-service';
import { findOrCreateContact } from 'src/lib/contacts';
import { type AppointmentTypeRecord, type BookingLinkRecord, type IntakeQuestion, loadSettings, membershipOf } from 'src/lib/records';
import { newNonce } from 'src/lib/tokens';

export class BookingError extends Error {
  constructor(
    readonly code: 'SLOT_TAKEN' | 'INVALID' | 'NOT_BOOKABLE' | 'LOCATION_REQUIRED' | 'TOO_LATE' | 'NOT_FOUND',
    message: string,
  ) {
    super(message);
  }
}

export type BookingRequest = {
  type: AppointmentTypeRecord;
  link: BookingLinkRecord | null;
  start: number;
  advisorId?: string | null;
  customer: { name: string; email: string; phone?: string | null; timeZone: string };
  answers: Record<string, string>;
  location: CustomerLocation | null;
  idempotencyKey: string;
  source: 'PUBLIC_PAGE' | 'EMBED' | 'MANUAL' | 'API';
  now?: number;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const validateBookingInput = (request: Pick<BookingRequest, 'customer' | 'answers' | 'type'>) => {
  const problems: string[] = [];
  const { customer } = request;
  if (!customer.name?.trim() || customer.name.length > 120) problems.push('Enter your name.');
  if (!EMAIL.test(customer.email ?? '') || customer.email.length > 200) problems.push('Enter a valid email address.');
  if (customer.phone && !/^[+\d][\d\s()-]{6,24}$/.test(customer.phone)) problems.push('Enter a valid phone number.');
  if (request.type.meetingFormat === 'PHONE' && !customer.phone) problems.push('A phone number is needed for a phone appointment.');
  for (const question of (request.type.intakeQuestions ?? []) as IntakeQuestion[]) {
    const answer = (request.answers[question.id] ?? '').trim();
    if (question.required && !answer) problems.push(`Answer "${question.label}".`);
    if (answer.length > 2000) problems.push(`"${question.label}" is too long.`);
    if (answer && question.type === 'select' && question.options && !question.options.includes(answer)) problems.push(`Choose an option for "${question.label}".`);
  }
  if (problems.length > 0) throw new BookingError('INVALID', problems.join(' '));
};

type FairnessRow = { advisorId: string; status: string; createdAt: string; startsAt: string; endsAt: string };

// Fairness comes from the bookings themselves: cancelled ones do not count, so a cancelled assignment returns to the
// pool (see README, "Round-robin fairness").
const fairnessCandidates = async (type: AppointmentTypeRecord, available: AdvisorAvailability[], start: number, now: number): Promise<AssignmentCandidate[]> => {
  const ids = available.map((item) => item.advisor.id);
  const windowDays = type.team?.fairnessWindowDays ?? 30;
  const data = await gql<{ appointments: { edges: { node: FairnessRow }[] } }>(
    `query($filter: AppointmentFilterInput!) { appointments(filter: $filter, first: 2000) { edges { node { advisorId status createdAt startsAt endsAt } } } }`,
    {
      filter: {
        advisorId: { in: ids },
        createdAt: { gte: new Date(now - windowDays * DAY).toISOString() },
        status: { neq: 'CANCELLED' },
        // Fairness is per team: an advisor's own one-to-one bookings do not count against their team share.
        ...(type.teamId ? { teamId: { eq: type.teamId } } : { appointmentTypeId: { eq: type.id } }),
      },
    },
  );
  const rows = nodes(data.appointments);
  return available.map((item) => {
    const own = rows.filter((row) => row.advisorId === item.advisor.id);
    const membership = membershipOf(type, item.advisor.id);
    return {
      advisorId: item.advisor.id,
      name: item.advisor.name,
      weight: membership?.weight ?? item.advisor.weight ?? 1,
      priority: membership?.priority ?? item.advisor.priority ?? 0,
      assignedCount: own.length,
      lastAssignedAt: own.length > 0 ? Math.max(...own.map((row) => Date.parse(row.createdAt))) : null,
      upcomingBookedMinutes: own.filter((row) => Date.parse(row.startsAt) >= now).reduce((total, row) => total + (Date.parse(row.endsAt) - Date.parse(row.startsAt)) / MINUTE, 0),
      earliestStart: item.starts[0] ?? null,
    };
  });
};

const isUniqueViolation = (error: unknown) => /duplicate|unique constraint/i.test((error as Error).message);

const createReservations = (keys: { key: string; advisorId: string; startsAt: string; appointmentId?: string }[]) =>
  gql(`mutation($data: [SlotReservationCreateInput!]!) { createSlotReservations(data: $data) { id } }`, { data: keys });

export const releaseReservations = (filter: { appointmentId?: string; keys?: string[] }) =>
  gql(`mutation($filter: SlotReservationFilterInput!) { destroySlotReservations(filter: $filter) { id } }`, {
    filter: filter.appointmentId ? { appointmentId: { eq: filter.appointmentId } } : { key: { in: filter.keys } },
  });

const tickRows = (advisorId: string, start: number, end: number, type: AppointmentTypeRecord) =>
  reservationKeys(advisorId, heldInterval(start, end, type.bufferBeforeMinutes ?? 0, type.bufferAfterMinutes ?? 0)).map((key) => ({
    key,
    advisorId,
    startsAt: key.split('|')[1],
  }));

type Plan = { hostId: string; participants: string[]; rows: { key: string; advisorId: string; startsAt: string }[]; sessionKey: string; seat: number | null; reason: string };

// Claim every tick the booking holds in one INSERT. A unique key clash means someone else got there first.
const tryPlans = async (plans: Plan[]) => {
  for (const plan of plans) {
    try {
      await createReservations(plan.rows);
      return plan;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return null;
};

const orderedPlans = async (request: BookingRequest, candidates: AdvisorAvailability[], start: number, end: number, now: number): Promise<Plan[]> => {
  const { type } = request;
  const capacity = Math.max(1, type.capacity ?? 1);
  const at = new Date(start).toISOString();

  if (type.assignment === 'COLLECTIVE') {
    const everyone = candidates.map((item) => item.advisor.id);
    const hostId = type.ownerId && everyone.includes(type.ownerId) ? type.ownerId : everyone[0];
    return [
      {
        hostId,
        participants: everyone,
        rows: everyone.flatMap((advisorId) => tickRows(advisorId, start, end, type)),
        sessionKey: '',
        seat: null,
        reason: `Collective: all ${everyone.length} team members are free`,
      },
    ];
  }

  let ordered: { advisorId: string; reason: string }[];
  const geoRanked = ['NEAREST', 'FASTEST', 'FIRST_AVAILABLE_NEARBY', 'WITHIN_RADIUS', 'TERRITORY'].includes(type.locationMode);
  if (candidates.length === 1) ordered = [{ advisorId: candidates[0].advisor.id, reason: request.advisorId ? 'Chosen by the customer' : 'Only eligible advisor' }];
  else if (geoRanked && type.locationMode !== 'WITHIN_RADIUS' && type.locationMode !== 'TERRITORY')
    ordered = candidates.map((item, index) => ({
      advisorId: item.advisor.id,
      reason: `${type.locationMode.toLowerCase().replace(/_/g, ' ')}: rank ${index + 1}${item.measure ? `, ${item.measure.roadKm ?? item.measure.straightKm?.toFixed(1)} km, ${item.measure.travelMinutes ?? '?'} min${item.measure.routed ? '' : ' (estimated)'}` : ''}`,
    }));
  else {
    const strategy = (type.assignment === 'FIRST_AVAILABLE' ? 'FIRST_AVAILABLE' : type.roundRobinStrategy || 'EQUAL') as RoundRobinStrategy;
    const pick = pickAdvisor(await fairnessCandidates(type, candidates, start, now), strategy);
    ordered = pick ? [pick.winner, ...pick.fallbacks].map((candidate, index) => ({ advisorId: candidate.advisorId, reason: index === 0 ? pick.reason : `${strategy}: next in line after a clash` })) : [];
  }

  return ordered.flatMap(({ advisorId, reason }) => {
    const availability = candidates.find((item) => item.advisor.id === advisorId);
    const session = availability?.sessions.get(start);
    if (capacity > 1 && session) {
      // Joining a group session: only a seat is claimed; the host is already held by the session.
      return Array.from({ length: capacity - session.booked }, (_, index) => session.booked + index + 1).map((seat) => ({
        hostId: advisorId,
        participants: [advisorId],
        rows: [{ key: seatKey(session.sessionKey, seat), advisorId, startsAt: at }],
        sessionKey: session.sessionKey,
        seat,
        reason: `${reason}; group session seat ${seat} of ${capacity}`,
      }));
    }
    const sessionKey = capacity > 1 ? `${type.id}|${advisorId}|${at}` : '';
    return [
      {
        hostId: advisorId,
        participants: [advisorId],
        rows: [...tickRows(advisorId, start, end, type), ...(capacity > 1 ? [{ key: seatKey(sessionKey, 1), advisorId, startsAt: at }] : [])],
        sessionKey,
        seat: capacity > 1 ? 1 : null,
        reason: capacity > 1 ? `${reason}; new group session, seat 1 of ${capacity}` : reason,
      },
    ];
  });
};

export type BookingResult = { appointmentId: string; nonce: string; start: number; end: number; advisorName: string; status: AppointmentStatus; existing: boolean };

// A repeated submit returns the same booking, but only to the same customer for the same type: the key alone is not
// a secret (staff can read it), so it must never hand out someone else's manage link.
const existingByKey = async (request: BookingRequest) => {
  const data = await gql<{ appointments: { edges: { node: { id: string; manageNonce: string; startsAt: string; endsAt: string; status: AppointmentStatus; customerEmail: string; appointmentTypeId: string | null; advisor: { name: string } | null } }[] } }>(
    `query($key: String!) { appointments(filter: { idempotencyKey: { eq: $key } }, first: 1) { edges { node { id manageNonce startsAt endsAt status customerEmail appointmentTypeId advisor { name } } } } }`,
    { key: request.idempotencyKey },
  );
  const found = nodes(data.appointments)[0];
  if (found && (found.customerEmail !== request.customer.email.trim().toLowerCase() || found.appointmentTypeId !== request.type.id))
    throw new BookingError('SLOT_TAKEN', 'That time is no longer available. Please pick another.');
  return found
    ? { appointmentId: found.id, nonce: found.manageNonce, start: Date.parse(found.startsAt), end: Date.parse(found.endsAt), advisorName: found.advisor?.name ?? '', status: found.status, existing: true }
    : null;
};

const locationText = (request: BookingRequest) => {
  const { type } = request;
  if (type.meetingFormat === 'AT_CUSTOMER') return request.location?.label ?? '';
  if (type.meetingFormat === 'IN_PERSON_OFFICE') return type.office ? `${type.office.name}, ${type.office.streetAddress} ${type.office.postcode}`.trim() : '';
  if (type.meetingFormat === 'PHONE') return `Phone: ${request.customer.phone ?? ''}`;
  return type.conferencing === 'FIXED_LINK' ? type.meetingUrl : '';
};

// Books one appointment. Availability is recomputed from live sources first; the reservation insert is the final,
// atomic check. Side effects (calendar events, emails, audit) follow from the created record.
export const bookAppointment = async (request: BookingRequest): Promise<BookingResult> => {
  const now = request.now ?? Date.now();
  const { type } = request;
  const repeat = await existingByKey(request);
  if (repeat) return repeat;
  if (type.status !== 'ACTIVE') throw new BookingError('NOT_BOOKABLE', 'This appointment type is not taking bookings.');
  if (request.link && !request.link.isActive) throw new BookingError('NOT_BOOKABLE', 'This booking link is switched off.');
  validateBookingInput(request);

  const start = request.start;
  const end = start + type.durationMinutes * MINUTE;
  const fixedAdvisorId = request.link?.advisorId ?? (['CUSTOMER_CHOICE'].includes(type.assignment) || type.locationMode === 'CUSTOMER_CHOICE' ? request.advisorId : null);
  if ((type.assignment === 'CUSTOMER_CHOICE' || type.locationMode === 'CUSTOMER_CHOICE') && !fixedAdvisorId) throw new BookingError('INVALID', 'Choose an advisor.');

  let search;
  try {
    search = await searchAvailability({ type, fixedAdvisorId, from: start - DAY, to: end + DAY, now, customer: request.location });
  } catch (error) {
    if ((error as { code?: string }).code === 'LOCATION_REQUIRED') throw new BookingError('LOCATION_REQUIRED', (error as Error).message);
    throw error;
  }
  const slot = search.slots.find((candidate) => candidate.start === start);
  if (!slot) throw new BookingError('SLOT_TAKEN', 'That time is no longer available. Please pick another.');
  const free = search.advisors.filter((item) => slot.advisorIds.includes(item.advisor.id));
  const plan = await tryPlans(await orderedPlans(request, free, start, end, now));
  if (!plan) throw new BookingError('SLOT_TAKEN', 'Someone has just booked that time. Please pick another.');

  try {
    const settings = await loadSettings();
    const contact = await findOrCreateContact({ name: request.customer.name, email: request.customer.email, phone: request.customer.phone ?? null }, settings);
    const host = free.find((item) => item.advisor.id === plan.hostId);
    const travel = host?.travel.get(start);
    const nonce = newNonce();
    const status: AppointmentStatus = type.requiresApproval ? 'PENDING' : 'CONFIRMED';
    const { createAppointment } = await gql<{ createAppointment: { id: string } }>(`mutation($data: AppointmentCreateInput!) { createAppointment(data: $data) { id } }`, {
      data: {
        title: `${type.name}: ${request.customer.name}`,
        status,
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
        customerTimeZone: request.customer.timeZone,
        customerName: request.customer.name.trim(),
        customerEmail: request.customer.email.trim().toLowerCase(),
        customerPhone: request.customer.phone ?? '',
        meetingFormat: type.meetingFormat,
        location: locationText(request),
        customerLatitude: request.location?.point.lat ?? null,
        customerLongitude: request.location?.point.lng ?? null,
        customerPostcode: request.location?.postcode ?? '',
        meetingUrl: type.conferencing === 'FIXED_LINK' ? type.meetingUrl : '',
        intakeAnswers: request.answers,
        source: request.source,
        sessionKey: plan.sessionKey,
        seat: plan.seat,
        assignmentReason: plan.reason,
        travelMinutes: travel?.minutes ?? null,
        travelCheck: travel ? (travel.verified ? 'Checked with road routing' : 'Estimated: routing was unavailable') : '',
        manageNonce: nonce,
        idempotencyKey: request.idempotencyKey,
        calendarStatus: 'NOT_CONNECTED',
        appointmentTypeId: type.id,
        advisorId: plan.hostId,
        teamId: type.teamId,
        officeId: type.office?.id ?? null,
        bookingLinkId: request.link?.id ?? null,
        personId: contact.personId,
        companyId: contact.companyId,
      },
    });
    await gql(`mutation($keys: [String!], $data: SlotReservationUpdateInput!) { updateSlotReservations(filter: { key: { in: $keys } }, data: $data) { id } }`, {
      keys: plan.rows.map((row) => row.key),
      data: { appointmentId: createAppointment.id },
    });
    await gql(`mutation($data: [AppointmentParticipantCreateInput!]!) { createAppointmentParticipants(data: $data) { id } }`, {
      data: plan.participants.map((advisorId) => ({
        name: free.find((item) => item.advisor.id === advisorId)?.advisor.name ?? '',
        participantRole: advisorId === plan.hostId ? 'HOST' : 'REQUIRED',
        appointmentId: createAppointment.id,
        advisorId,
      })),
    });
    return { appointmentId: createAppointment.id, nonce, start, end, advisorName: host?.advisor.name ?? '', status, existing: false };
  } catch (error) {
    await releaseReservations({ keys: plan.rows.map((row) => row.key) });
    // Two identical submissions at once: the second hits the unique idempotency key, so return the first booking.
    if (isUniqueViolation(error)) {
      const winner = await existingByKey(request);
      if (winner) return winner;
    }
    throw error;
  }
};

export type AppointmentRecord = {
  id: string;
  title: string;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerTimeZone: string;
  meetingFormat: string;
  location: string;
  meetingUrl: string;
  manageNonce: string;
  sessionKey: string;
  seat: number | null;
  cancelledAt: string | null;
  remindersSent: string;
  notifiedStartsAt: string | null;
  calendarStatus: string;
  intakeAnswers: Record<string, string> | null;
  appointmentTypeId: string | null;
  advisorId: string | null;
  personId: string | null;
  customerLatitude: number | null;
  customerLongitude: number | null;
  customerPostcode: string;
  advisor: { id: string; name: string; email: string; timeZone: string; workspaceMemberId: string | null; createdBy?: { workspaceMemberId: string | null } | null } | null;
  appointmentType: AppointmentTypeRecord | null;
  participants: { edges: { node: { advisorId: string; participantRole: string } }[] };
};

export const APPOINTMENT_FIELDS = `id title status startsAt endsAt customerName customerEmail customerPhone customerTimeZone meetingFormat location meetingUrl manageNonce
  sessionKey seat cancelledAt remindersSent notifiedStartsAt calendarStatus intakeAnswers appointmentTypeId advisorId personId customerLatitude customerLongitude customerPostcode
  advisor { id name email timeZone workspaceMemberId createdBy { workspaceMemberId } }
  participants(first: 50) { edges { node { advisorId participantRole } } }`;

export const loadAppointment = async (id: string, typeFields: string) => {
  const data = await gql<{ appointments: { edges: { node: AppointmentRecord }[] } }>(
    `query($id: UUID!) { appointments(filter: { id: { eq: $id } }) { edges { node { ${APPOINTMENT_FIELDS} appointmentType { ${typeFields} } } } } }`,
    { id },
  );
  return nodes(data.appointments)[0] ?? null;
};

export const updateAppointment = (id: string, data: Record<string, unknown>) =>
  gql(`mutation($id: UUID!, $data: AppointmentUpdateInput!) { updateAppointment(id: $id, data: $data) { id } }`, { id, data });

const assertBefore = (appointment: AppointmentRecord, hours: number | null | undefined, action: string, now: number) => {
  if (hours && Date.parse(appointment.startsAt) - now < hours * 3600 * 1000)
    throw new BookingError('TOO_LATE', `It is too late to ${action} online (less than ${hours} hours before). Please contact us.`);
};

// Customer, advisor and admin cancellations all end here; the status change drives the calendar delete and emails.
export const cancelAppointment = async (appointment: AppointmentRecord, by: string, reason: string, { enforceCutoff, now = Date.now() }: { enforceCutoff: boolean; now?: number }) => {
  if (appointment.status === 'CANCELLED') return;
  if (enforceCutoff) assertBefore(appointment, appointment.appointmentType?.cancellationCutoffHours, 'cancel', now);
  await updateAppointment(appointment.id, { status: 'CANCELLED', cancelledAt: new Date(now).toISOString(), cancelledBy: by, cancelReason: reason.slice(0, 500) });
};

// The new time is claimed before the old one is released, so a failed reschedule leaves the booking as it was.
export const rescheduleAppointment = async (appointment: AppointmentRecord, newStart: number, by: string, { enforceCutoff, now = Date.now() }: { enforceCutoff: boolean; now?: number }) => {
  const type = appointment.appointmentType;
  if (!type || !appointment.advisorId) throw new BookingError('NOT_BOOKABLE', 'This appointment cannot be moved online.');
  if (appointment.status === 'CANCELLED') throw new BookingError('NOT_BOOKABLE', 'This appointment was cancelled.');
  if (enforceCutoff) assertBefore(appointment, type.rescheduleCutoffHours, 'reschedule', now);
  const end = newStart + type.durationMinutes * MINUTE;
  const participants = nodes(appointment.participants).map((participant) => participant.advisorId);
  const advisors = participants.length > 0 ? participants : [appointment.advisorId];

  const oldRows = await gql<{ slotReservations: { edges: { node: { key: string } }[] } }>(
    `query($id: UUID!) { slotReservations(filter: { appointmentId: { eq: $id } }, first: 1000) { edges { node { key } } } }`,
    { id: appointment.id },
  );
  const previous = nodes(oldRows.slotReservations).map((row) => row.key);
  const location =
    appointment.customerLatitude !== null && appointment.customerLongitude !== null
      ? { point: { lat: appointment.customerLatitude, lng: appointment.customerLongitude }, postcode: appointment.customerPostcode || null, label: appointment.location }
      : null;
  const search = await searchAvailability({
    type: { ...type, assignment: advisors.length > 1 ? 'COLLECTIVE' : 'ONE_TO_ONE', ownerId: advisors[0], locationMode: 'NONE' },
    fixedAdvisorId: advisors.length > 1 ? null : advisors[0],
    from: newStart - DAY,
    to: end + DAY,
    now,
    customer: location,
    ignore: { appointmentId: appointment.id, interval: { start: Date.parse(appointment.startsAt), end: Date.parse(appointment.endsAt) } },
  });
  if (!search.slots.some((slot) => slot.start === newStart)) throw new BookingError('SLOT_TAKEN', 'That time is not available.');

  const rows = advisors.flatMap((advisorId) => tickRows(advisorId, newStart, end, type));
  const ownTicks = new Set(previous);
  const fresh = rows.filter((row) => !ownTicks.has(row.key));
  try {
    if (fresh.length > 0) await createReservations(fresh.map((row) => ({ ...row, appointmentId: appointment.id })));
  } catch (error) {
    if (isUniqueViolation(error)) throw new BookingError('SLOT_TAKEN', 'Someone has just booked that time. Please pick another.');
    throw error;
  }
  const keep = new Set(rows.map((row) => row.key));
  const stale = previous.filter((key) => !keep.has(key));
  await updateAppointment(appointment.id, {
    startsAt: new Date(newStart).toISOString(),
    endsAt: new Date(end).toISOString(),
    status: appointment.status === 'PENDING' ? 'PENDING' : 'RESCHEDULED',
  });
  if (stale.length > 0) await releaseReservations({ keys: stale });
  await gql(`mutation($data: SchedulingAuditEventCreateInput!) { createSchedulingAuditEvent(data: $data) { id } }`, {
    data: { name: 'appointment.rescheduled', actor: by, appointmentId: appointment.id, occurredAt: new Date(now).toISOString(), details: { from: appointment.startsAt, to: new Date(newStart).toISOString() } },
  });
};

export const recentBookingsFor = (advisorIds: string[], now: number) => appointmentsFor(advisorIds, now - 30 * DAY, now + 90 * DAY);
