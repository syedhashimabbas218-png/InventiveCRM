import { randomUUID } from 'node:crypto';

import { isValidTimeZone, MINUTE } from 'src/engine/time';
import { type CustomerLocation, searchAvailability } from 'src/lib/availability-service';
import {
  type AppointmentRecord,
  bookAppointment,
  BookingError,
  cancelAppointment,
  loadAppointment,
  rescheduleAppointment,
} from 'src/lib/booking';
import { geocode, reverseGeocode } from 'src/lib/geo/services';
import { manageUrl } from 'src/lib/notify';
import { rateLimit } from 'src/lib/rate-limit';
import {
  type AdvisorRecord,
  advisorPoint,
  type AppointmentTypeRecord,
  type BookingLinkRecord,
  candidateAdvisorIds,
  loadAdvisors,
  loadSettings,
  loadTypesForAdvisor,
  resolveSlug,
  TYPE_FIELDS,
} from 'src/lib/records';
import { checkFormTicket, formTicket, parseManageToken, verifyManageToken } from 'src/lib/tokens';

export class PublicError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Headers = Record<string, string | undefined>;
type Body = Record<string, unknown>;

const text = (value: unknown, max = 500) => (typeof value === 'string' ? value.slice(0, max) : '');

const resolveBookable = async (slug: string) => {
  const resolved = await resolveSlug(text(slug, 120));
  const type = resolved.type ?? resolved.link?.appointmentType ?? null;
  if (!type || type.status !== 'ACTIVE' || (resolved.link && !resolved.link.isActive)) throw new PublicError(404, 'NOT_FOUND', 'This booking page does not exist or is not taking bookings.');
  return { type, link: resolved.link as BookingLinkRecord | null };
};

const publicOffice = (type: AppointmentTypeRecord) =>
  type.office && type.office.isPublic
    ? { name: type.office.name, address: `${type.office.streetAddress} ${type.office.postcode}`.trim(), lat: type.office.latitude, lng: type.office.longitude }
    : type.office
      ? { name: type.office.name, address: '', lat: null, lng: null }
      : null;

// Exact bases stay private: a public office location is shown as is, otherwise the base is rounded to about 1 km.
const publicAdvisor = (advisor: AdvisorRecord) => {
  const point = advisorPoint(advisor);
  const officePublic = advisor.office?.isPublic && advisor.office.latitude !== null;
  return {
    id: advisor.id,
    name: advisor.name,
    bio: advisor.publicBio || '',
    locationLabel: advisor.publicLocationLabel || (officePublic ? advisor.office?.name : '') || '',
    point: officePublic ? { lat: advisor.office?.latitude, lng: advisor.office?.longitude, approximate: false } : point ? { lat: Math.round(point.lat * 100) / 100, lng: Math.round(point.lng * 100) / 100, approximate: true } : null,
  };
};

const parseLocation = async (value: unknown): Promise<CustomerLocation | null> => {
  const raw = value as { lat?: unknown; lng?: unknown; label?: unknown; postcode?: unknown } | null;
  if (!raw || typeof raw.lat !== 'number' || typeof raw.lng !== 'number' || Math.abs(raw.lat) > 90 || Math.abs(raw.lng) > 180) return null;
  let postcode = text(raw.postcode, 12) || null;
  let label = text(raw.label, 300);
  if ((!postcode || !label) && process.env.GEOCODER_URL) {
    const reverse = await reverseGeocode({ lat: raw.lat, lng: raw.lng }).catch(() => null);
    postcode = postcode ?? reverse?.postcode ?? null;
    label = label || reverse?.label || `${raw.lat.toFixed(5)}, ${raw.lng.toFixed(5)}`;
  }
  return { point: { lat: raw.lat, lng: raw.lng }, postcode, label };
};

const embedAllowed = (type: AppointmentTypeRecord, parentOrigin: string) => {
  const allowed = type.allowedEmbedDomains.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (allowed.length === 0) return true;
  try {
    const host = new URL(parentOrigin).hostname.toLowerCase();
    return allowed.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
};

const pageInfo = async (slug: string) => {
  const resolved = await resolveSlug(text(slug, 120));
  if (!resolved.type && !resolved.link && resolved.advisor?.isActive) {
    const types = await loadTypesForAdvisor(resolved.advisor.id);
    return {
      kind: 'advisor',
      advisor: { name: resolved.advisor.name, bio: resolved.advisor.publicBio },
      types: types.map((type) => ({ name: type.name, slug: type.slug, description: type.description, durationMinutes: type.durationMinutes, meetingFormat: type.meetingFormat })),
    };
  }
  const { type, link } = await resolveBookable(slug);
  const showAdvisors = type.assignment === 'CUSTOMER_CHOICE' && type.locationMode === 'NONE' && !link?.advisorId;
  const advisors = showAdvisors ? (await loadAdvisors(candidateAdvisorIds(type))).filter((advisor) => advisor.isActive).map(publicAdvisor) : [];
  const settings = await loadSettings();
  return {
    kind: 'type',
    slug,
    ticket: formTicket(slug),
    type: {
      name: link?.title || type.name,
      description: link?.description || type.description,
      durationMinutes: type.durationMinutes,
      meetingFormat: type.meetingFormat,
      conferencing: type.conferencing,
      assignment: type.assignment,
      locationMode: type.locationMode,
      needsLocation: type.locationMode !== 'NONE' || type.meetingFormat === 'AT_CUSTOMER',
      capacity: type.capacity ?? 1,
      color: type.color || '#1961ED',
      timeZone: type.timeZone || settings.defaultTimeZone,
      intakeQuestions: (type.intakeQuestions ?? []).filter((question) => !link?.presets?.hide?.includes(question.id)),
      office: publicOffice(type),
      team: type.team?.name ?? null,
      allowedEmbedDomains: type.allowedEmbedDomains,
    },
    advisors,
    presets: link?.presets ? { name: link.presets.name ?? '', email: link.presets.email ?? '', answers: link.presets.answers ?? {} } : null,
    map: { tileUrl: process.env.MAP_TILE_URL || '', attribution: process.env.MAP_ATTRIBUTION || '© OpenStreetMap contributors', geocoder: Boolean(process.env.GEOCODER_URL) },
  };
};

const slots = async (body: Body) => {
  const { type, link } = await resolveBookable(text(body.slug, 120));
  const from = Date.parse(text(body.from, 40));
  const days = Math.min(35, Math.max(1, Number(body.days) || 7));
  if (!Number.isFinite(from)) throw new PublicError(400, 'INVALID', 'from must be an ISO date.');
  const location = await parseLocation(body.location);
  try {
    const result = await searchAvailability({
      type,
      fixedAdvisorId: link?.advisorId ?? (typeof body.advisorId === 'string' ? body.advisorId : null),
      from,
      to: from + days * 24 * 60 * MINUTE,
      now: Date.now(),
      customer: location,
    });
    return {
      slots: result.slots.map((slot) => ({ start: new Date(slot.start).toISOString(), end: new Date(slot.end).toISOString(), seatsLeft: slot.seatsLeft })),
      routing: result.routing,
    };
  } catch (error) {
    if ((error as { code?: string }).code === 'LOCATION_REQUIRED') throw new PublicError(400, 'LOCATION_REQUIRED', (error as Error).message);
    throw error;
  }
};

const nearbyAdvisors = async (body: Body) => {
  const { type, link } = await resolveBookable(text(body.slug, 120));
  const location = await parseLocation(body.location);
  if (!location) throw new PublicError(400, 'LOCATION_REQUIRED', 'Choose a location first.');
  const from = Date.now();
  const result = await searchAvailability({ type, fixedAdvisorId: link?.advisorId ?? null, from, to: from + 14 * 24 * 60 * MINUTE, now: from, customer: location });
  return {
    routing: result.routing,
    customer: { lat: location.point.lat, lng: location.point.lng, label: location.label },
    advisors: result.advisors.map((item) => ({
      ...publicAdvisor(item.advisor),
      distanceKm: item.measure?.roadKm ?? (item.measure?.straightKm !== null && item.measure?.straightKm !== undefined ? Math.round(item.measure.straightKm * 10) / 10 : null),
      travelMinutes: item.measure?.travelMinutes ?? null,
      routed: item.measure?.routed ?? false,
      earliest: item.starts[0] ? new Date(item.starts[0]).toISOString() : null,
    })),
    excludedCount: result.excluded.length,
  };
};

const book = async (body: Body, headers: Headers) => {
  const slug = text(body.slug, 120);
  if (text(body.website, 200)) throw new PublicError(400, 'INVALID', 'Unable to book.');
  const ticket = checkFormTicket(slug, text(body.ticket, 200));
  if (ticket !== 'ok') throw new PublicError(400, 'INVALID', ticket === 'too-fast' ? 'Please take a moment to check your details.' : 'The page has expired. Please reload it.');
  const settings = await loadSettings();
  await rateLimit(headers, 'book', settings.bookingsPerHourPerClient ?? 10, 3600);
  const { type, link } = await resolveBookable(slug);
  const parentOrigin = text(body.parentOrigin, 300);
  if (body.embed && parentOrigin && !embedAllowed(type, parentOrigin)) throw new PublicError(403, 'EMBED_NOT_ALLOWED', 'Bookings are not accepted from this website.');
  const customer = body.customer as { name?: unknown; email?: unknown; phone?: unknown; timeZone?: unknown } | undefined;
  const timeZone = text(customer?.timeZone, 64);
  const start = Date.parse(text(body.start, 40));
  if (!Number.isFinite(start)) throw new PublicError(400, 'INVALID', 'Choose a time.');
  const answers = Object.fromEntries(Object.entries((body.answers as Record<string, unknown>) ?? {}).slice(0, 30).map(([key, value]) => [key.slice(0, 64), text(value, 2000)]));
  const result = await bookAppointment({
    type,
    link,
    start,
    advisorId: typeof body.advisorId === 'string' ? body.advisorId : null,
    customer: { name: text(customer?.name, 120), email: text(customer?.email, 200), phone: text(customer?.phone, 40) || null, timeZone: isValidTimeZone(timeZone) ? timeZone : type.timeZone || settings.defaultTimeZone },
    answers,
    location: await parseLocation(body.location),
    idempotencyKey: text(body.idempotencyKey, 80) || randomUUID(),
    source: body.embed ? 'EMBED' : 'PUBLIC_PAGE',
  });
  return {
    status: result.status,
    start: new Date(result.start).toISOString(),
    end: new Date(result.end).toISOString(),
    advisorName: result.advisorName,
    manageUrl: await manageUrl({ id: result.appointmentId, manageNonce: result.nonce }),
    confirmationMessage: type.confirmationMessage || '',
  };
};

const appointmentFromToken = async (token: string) => {
  const parsed = parseManageToken(text(token, 120));
  if (!parsed) throw new PublicError(404, 'NOT_FOUND', 'This link is not valid.');
  const appointment = await loadAppointment(parsed.appointmentId, TYPE_FIELDS);
  if (!appointment || !verifyManageToken(token, appointment.manageNonce)) throw new PublicError(404, 'NOT_FOUND', 'This link is not valid.');
  return appointment;
};

const summary = (appointment: AppointmentRecord) => {
  const type = appointment.appointmentType;
  const hoursLeft = (Date.parse(appointment.startsAt) - Date.now()) / 3600_000;
  const active = appointment.status !== 'CANCELLED' && appointment.status !== 'COMPLETED' && appointment.status !== 'NO_SHOW' && hoursLeft > 0;
  return {
    status: appointment.status,
    start: appointment.startsAt,
    end: appointment.endsAt,
    timeZone: appointment.customerTimeZone,
    typeName: type?.name ?? 'Appointment',
    slug: type?.slug ?? '',
    advisorName: appointment.advisor?.name ?? '',
    location: appointment.location,
    meetingUrl: appointment.meetingUrl,
    canCancel: active && hoursLeft >= (type?.cancellationCutoffHours ?? 0),
    canReschedule: active && hoursLeft >= (type?.rescheduleCutoffHours ?? 0) && !appointment.sessionKey,
    cancellationCutoffHours: type?.cancellationCutoffHours ?? 0,
    rescheduleCutoffHours: type?.rescheduleCutoffHours ?? 0,
  };
};

export const handlePublicApi = async (body: Body, headers: Headers) => {
  const action = text(body.action, 40);
  switch (action) {
    case 'page':
      await rateLimit(headers, 'page', 120, 60);
      return pageInfo(text(body.slug, 120));
    case 'slots':
      await rateLimit(headers, 'slots', 60, 60);
      return slots(body);
    case 'geocode': {
      await rateLimit(headers, 'geocode', 30, 60);
      const query = text(body.query, 200).trim();
      if (query.length < 3) return { results: [] };
      return { results: await geocode(query) };
    }
    case 'advisors':
      await rateLimit(headers, 'advisors', 30, 60);
      return nearbyAdvisors(body);
    case 'book':
      return book(body, headers);
    case 'manage': {
      await rateLimit(headers, 'manage', 30, 60);
      return summary(await appointmentFromToken(text(body.token, 120)));
    }
    case 'cancel': {
      await rateLimit(headers, 'manage', 30, 60);
      const appointment = await appointmentFromToken(text(body.token, 120));
      await cancelAppointment(appointment, 'customer', text(body.reason, 500), { enforceCutoff: true });
      return summary({ ...appointment, status: 'CANCELLED' });
    }
    case 'reschedule': {
      await rateLimit(headers, 'manage', 30, 60);
      const appointment = await appointmentFromToken(text(body.token, 120));
      const start = Date.parse(text(body.start, 40));
      if (!Number.isFinite(start)) throw new PublicError(400, 'INVALID', 'Choose a new time.');
      await rescheduleAppointment(appointment, start, 'customer', { enforceCutoff: true });
      return summary((await loadAppointment(appointment.id, TYPE_FIELDS)) as AppointmentRecord);
    }
    case 'rescheduleSlots': {
      await rateLimit(headers, 'slots', 60, 60);
      const appointment = await appointmentFromToken(text(body.token, 120));
      const type = appointment.appointmentType;
      if (!type || !appointment.advisorId) throw new PublicError(400, 'NOT_BOOKABLE', 'This appointment cannot be moved online.');
      const from = Date.parse(text(body.from, 40));
      const participants = appointment.participants.edges.map((edge) => edge.node.advisorId);
      const result = await searchAvailability({
        type: { ...type, assignment: participants.length > 1 ? 'COLLECTIVE' : 'ONE_TO_ONE', ownerId: appointment.advisorId, locationMode: 'NONE' },
        fixedAdvisorId: participants.length > 1 ? null : appointment.advisorId,
        from,
        to: from + Math.min(35, Number(body.days) || 7) * 24 * 60 * MINUTE,
        now: Date.now(),
        customer: appointment.customerLatitude !== null && appointment.customerLongitude !== null ? { point: { lat: appointment.customerLatitude, lng: appointment.customerLongitude }, postcode: appointment.customerPostcode || null, label: appointment.location } : null,
        ignore: { appointmentId: appointment.id, interval: { start: Date.parse(appointment.startsAt), end: Date.parse(appointment.endsAt) } },
      });
      return { slots: result.slots.map((slot) => ({ start: new Date(slot.start).toISOString(), end: new Date(slot.end).toISOString(), seatsLeft: null })) };
    }
    default:
      throw new PublicError(400, 'INVALID', 'Unknown action.');
  }
};

export const errorResponse = (error: unknown) => {
  if (error instanceof PublicError) return { status: error.status, body: { error: error.code, message: error.message } };
  if (error instanceof BookingError) {
    const status = error.code === 'SLOT_TAKEN' ? 409 : error.code === 'NOT_FOUND' ? 404 : 400;
    return { status, body: { error: error.code, message: error.message } };
  }
  if ((error as { retryAfterSeconds?: number }).retryAfterSeconds !== undefined) return { status: 429, body: { error: 'RATE_LIMITED', message: (error as Error).message } };
  return { status: 500, body: { error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' } };
};
