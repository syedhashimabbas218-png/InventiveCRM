import { type Interval, mergeIntervals, subtractIntervals, workingIntervals } from 'src/engine/availability';
import { type GeoMeasure, geoEligibility, haversineKm, parseServiceArea, type Point, rankByLocation } from 'src/engine/geo';
import { generateSlots, RESERVATION_TICK_MINUTES } from 'src/engine/slots';
import { addDays, DAY, isoWeekKey, MINUTE, utcToZoned, zonedToUtc } from 'src/engine/time';
import { fallbackTravelMinutes, neighbouringStops, type Stop, travelFeasibility } from 'src/engine/travel';
import { gql, nodes } from 'src/lib/api';
import { advisorExternalBusy, loadAdvisorCalendars } from 'src/lib/calendar/connections';
import { travelMatrix } from 'src/lib/geo/services';
import {
  type AdvisorRecord,
  advisorPoint,
  advisorSchedule,
  type AppointmentTypeRecord,
  candidateAdvisorIds,
  loadAdvisors,
  loadSettings,
} from 'src/lib/records';

export type CustomerLocation = { point: Point; postcode: string | null; label: string };

export type BookedAppointment = {
  id: string;
  advisorId: string;
  appointmentTypeId: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  sessionKey: string;
  createdAt: string;
  customerLatitude: number | null;
  customerLongitude: number | null;
  meetingFormat: string | null;
  office: { latitude: number | null; longitude: number | null } | null;
};

export type AdvisorAvailability = {
  advisor: AdvisorRecord;
  starts: number[];
  failures: string[];
  measure: GeoMeasure | null;
  travel: Map<number, { minutes: number | null; verified: boolean }>;
  sessions: Map<number, { sessionKey: string; booked: number }>;
};

export type SearchResult = {
  slots: { start: number; end: number; advisorIds: string[]; seatsLeft: number | null }[];
  advisors: AdvisorAvailability[];
  excluded: { advisorId: string; name: string; reason: string }[];
  routing: 'ROAD' | 'STRAIGHT_LINE' | 'NOT_NEEDED';
};

const TICK = RESERVATION_TICK_MINUTES * MINUTE;

export const appointmentsFor = async (advisorIds: string[], from: number, to: number) => {
  if (advisorIds.length === 0) return [];
  const data = await gql<{ appointments: { edges: { node: BookedAppointment }[] } }>(
    `query($ids: [UUID!], $from: DateTime!, $to: DateTime!) {
      appointments(filter: { advisorId: { in: $ids }, startsAt: { lt: $to }, endsAt: { gt: $from }, status: { neq: CANCELLED } }, first: 1000) {
        edges { node { id advisorId appointmentTypeId startsAt endsAt status sessionKey createdAt customerLatitude customerLongitude meetingFormat office { latitude longitude } } }
      }
    }`,
    { ids: advisorIds, from: new Date(from).toISOString(), to: new Date(to).toISOString() },
  );
  return nodes(data.appointments);
};

// Reserved ticks are the authoritative busy time inside Twenty: they cover every booking's buffers and every
// participant of collective meetings.
const reservedIntervals = async (advisorIds: string[], from: number, to: number, ignoreAppointmentId: string | null) => {
  const byAdvisor = new Map<string, Interval[]>();
  if (advisorIds.length === 0) return byAdvisor;
  let after: string | null = null;
  for (;;) {
    const filter = {
      advisorId: { in: advisorIds },
      and: [
        { startsAt: { gte: new Date(from).toISOString() } },
        { startsAt: { lt: new Date(to).toISOString() } },
        ...(ignoreAppointmentId ? [{ or: [{ appointmentId: { is: 'NULL' } }, { appointmentId: { neq: ignoreAppointmentId } }] }] : []),
      ],
    };
    const data: { slotReservations: { edges: { node: { advisorId: string; startsAt: string } }[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } = await gql(
      `query($filter: SlotReservationFilterInput!, $after: String) {
        slotReservations(filter: $filter, first: 1000, after: $after) { edges { node { advisorId startsAt } } pageInfo { hasNextPage endCursor } }
      }`,
      { filter, after },
    );
    for (const { node } of data.slotReservations.edges) {
      const start = Date.parse(node.startsAt);
      byAdvisor.set(node.advisorId, [...(byAdvisor.get(node.advisorId) ?? []), { start, end: start + TICK }]);
    }
    if (!data.slotReservations.pageInfo.hasNextPage) break;
    after = data.slotReservations.pageInfo.endCursor;
  }
  for (const [advisorId, intervals] of byAdvisor) byAdvisor.set(advisorId, mergeIntervals(intervals));
  return byAdvisor;
};

// Days already at a limit become busy, so slot generation never offers them.
const limitBlocks = (bookings: BookedAppointment[], timeZone: string, daily: number | null, weekly: number | null, from: number, to: number) => {
  if (!daily && !weekly) return [];
  const perDay = new Map<string, number>();
  const perWeek = new Map<string, number>();
  for (const booking of bookings) {
    const date = utcToZoned(Date.parse(booking.startsAt), timeZone).date;
    perDay.set(date, (perDay.get(date) ?? 0) + 1);
    perWeek.set(isoWeekKey(date), (perWeek.get(isoWeekKey(date)) ?? 0) + 1);
  }
  const blocks: Interval[] = [];
  const last = utcToZoned(to, timeZone).date;
  for (let date = utcToZoned(from, timeZone).date; date <= last; date = addDays(date, 1)) {
    const full = (daily && (perDay.get(date) ?? 0) >= daily) || (weekly && (perWeek.get(isoWeekKey(date)) ?? 0) >= weekly);
    if (full) blocks.push({ start: zonedToUtc(date, '00:00', timeZone), end: zonedToUtc(addDays(date, 1), '00:00', timeZone) });
  }
  return blocks;
};

const bookingStop = (booking: BookedAppointment): Stop => ({
  start: Date.parse(booking.startsAt),
  end: Date.parse(booking.endsAt),
  location:
    booking.customerLatitude !== null && booking.customerLongitude !== null
      ? { lat: booking.customerLatitude, lng: booking.customerLongitude }
      : booking.office?.latitude != null && booking.office.longitude != null
        ? { lat: booking.office.latitude, lng: booking.office.longitude }
        : null,
});

const needsLocation = (type: AppointmentTypeRecord) => type.locationMode !== 'NONE' || type.meetingFormat === 'AT_CUSTOMER';

// Distance and travel time from each advisor's base to the customer. Road figures come from OSRM in one table call;
// if routing is down the straight line is used and every figure is marked as not routed.
const measureAdvisors = async (advisors: AdvisorRecord[], customer: Point) => {
  const bases = advisors.map(advisorPoint);
  const withBase = advisors.filter((_, index) => bases[index]);
  const measures = new Map<string, GeoMeasure>();
  let routed = false;
  try {
    if (withBase.length > 0) {
      const matrix = await travelMatrix(withBase.map(advisorPoint) as Point[], [customer]);
      withBase.forEach((advisor, index) =>
        measures.set(advisor.id, { straightKm: haversineKm(advisorPoint(advisor) as Point, customer), roadKm: matrix.km[index][0], travelMinutes: matrix.minutes[index][0], routed: true }),
      );
      routed = true;
    }
  } catch {
    routed = false;
  }
  for (const advisor of withBase)
    if (!measures.has(advisor.id)) {
      const base = advisorPoint(advisor) as Point;
      measures.set(advisor.id, { straightKm: haversineKm(base, customer), roadKm: null, travelMinutes: fallbackTravelMinutes(base, customer), routed: false });
    }
  return { measures, routed };
};

// Times this advisor could take, honouring working hours, overrides, Twenty bookings, connected calendars, limits,
// notice, horizon, buffers and, for advisors who drive to the customer, travel between stops.
const advisorStarts = async (
  advisor: AdvisorRecord,
  type: AppointmentTypeRecord,
  window: { from: number; to: number },
  reserved: Interval[],
  bookings: BookedAppointment[],
  now: number,
  customer: CustomerLocation | null,
  defaultTimeZone: string,
  ignore: Ignore | null,
): Promise<{ starts: number[]; failures: string[]; travel: Map<number, { minutes: number | null; verified: boolean }> }> => {
  const failures: string[] = [];
  const schedule = advisorSchedule(advisor, type);
  if (!schedule?.weeklyHours) return { starts: [], failures: ['no availability schedule'], travel: new Map() };
  const timeZone = schedule.timeZone || advisor.timeZone || defaultTimeZone;
  const working = workingIntervals({ rules: schedule.weeklyHours, overrides: nodes(schedule.overrides), timeZone, from: window.from, to: window.to });

  const calendars = await loadAdvisorCalendars(advisor);
  const external = await advisorExternalBusy(calendars, window.from - DAY, window.to + DAY);
  if (external.failures.length > 0) return { starts: [], failures: external.failures, travel: new Map() };

  // When moving an appointment, its own calendar event is still in the provider's busy time until the sync runs.
  const externalBusy = ignore ? subtractIntervals(external.intervals, [ignore.interval]) : external.intervals;
  const own = bookings.filter((booking) => booking.advisorId === advisor.id && booking.id !== ignore?.appointmentId);
  const ofType = own.filter((booking) => booking.appointmentTypeId === type.id);
  const busy = [
    ...reserved,
    ...externalBusy,
    ...limitBlocks(own, timeZone, advisor.dailyLimit, advisor.weeklyLimit, window.from, window.to),
    ...limitBlocks(ofType, timeZone, type.dailyLimit, type.weeklyLimit, window.from, window.to),
  ];
  const starts = generateSlots({
    rules: {
      durationMinutes: type.durationMinutes,
      incrementMinutes: type.incrementMinutes ?? type.durationMinutes,
      bufferBeforeMinutes: type.bufferBeforeMinutes ?? 0,
      bufferAfterMinutes: type.bufferAfterMinutes ?? 0,
      minimumNoticeMinutes: type.minimumNoticeMinutes ?? 0,
      horizonDays: type.horizonDays ?? 60,
    },
    working,
    busy,
    timeZone,
    now,
  });

  const travel = new Map<number, { minutes: number | null; verified: boolean }>();
  if (type.meetingFormat !== 'AT_CUSTOMER' || !advisor.travelsToCustomers || !customer) return { starts, failures, travel };

  // Travel between the stops either side of each candidate time, from one routing call for this advisor.
  const base = advisorPoint(advisor);
  const stops = own.map(bookingStop).filter((stop) => stop.location);
  const places: Point[] = [...(base ? [base] : []), ...stops.map((stop) => stop.location as Point)];
  let toCustomer: (number | null)[] = [];
  let fromCustomer: (number | null)[] = [];
  let verified = true;
  try {
    if (places.length > 0) {
      const there = await travelMatrix(places, [customer.point]);
      const back = await travelMatrix([customer.point], places);
      toCustomer = there.minutes.map((row) => row[0]);
      fromCustomer = back.minutes[0];
    }
  } catch {
    verified = false;
    toCustomer = places.map((place) => fallbackTravelMinutes(place, customer.point));
    fromCustomer = toCustomer;
  }
  if (!verified && type.requireVerifiedTravel) return { starts: [], failures: ['routing unavailable and this type only offers travel-checked times'], travel };
  const minutesFor = (point: Point | null, list: (number | null)[]) => {
    if (!point) return null;
    const index = places.findIndex((place) => place.lat === point.lat && place.lng === point.lng);
    return index >= 0 ? list[index] : null;
  };
  const feasible = starts.filter((start) => {
    const slot = { start, end: start + type.durationMinutes * MINUTE };
    const windowStart = working.find((interval) => interval.start <= start && start < interval.end)?.start ?? start;
    const { previous, next } = neighbouringStops(slot, stops, { start: windowStart }, base);
    const arrive = minutesFor(previous?.location ?? null, toCustomer);
    const leave = minutesFor(next?.location ?? null, fromCustomer);
    const check = travelFeasibility({
      slot,
      previous,
      next,
      toCustomer: arrive === null ? null : { minutes: arrive, verified },
      fromCustomer: leave === null ? null : { minutes: leave, verified },
      bufferMinutes: advisor.travelBufferMinutes ?? 0,
    });
    if (check.feasible) travel.set(start, { minutes: arrive, verified: check.verified });
    return check.feasible;
  });
  return { starts: feasible, failures, travel };
};

type Ignore = { appointmentId: string; interval: Interval };

export const searchAvailability = async ({
  type,
  fixedAdvisorId,
  from,
  to,
  now,
  customer,
  ignore = null,
}: {
  ignore?: Ignore | null;
  type: AppointmentTypeRecord;
  fixedAdvisorId?: string | null;
  from: number;
  to: number;
  now: number;
  customer: CustomerLocation | null;
}): Promise<SearchResult> => {
  const settings = await loadSettings();
  const window = { from: Math.max(from, now), to: Math.min(to, now + (type.horizonDays ?? 60) * DAY + DAY) };
  const excluded: SearchResult['excluded'] = [];
  let advisors = (await loadAdvisors(candidateAdvisorIds(type, fixedAdvisorId))).filter((advisor) => {
    if (advisor.isActive) return true;
    excluded.push({ advisorId: advisor.id, name: advisor.name, reason: 'inactive' });
    return false;
  });
  advisors = advisors.filter((advisor) => {
    const ok =
      type.meetingFormat === 'VIRTUAL' || type.meetingFormat === 'PHONE' ? advisor.remote !== false : type.meetingFormat === 'AT_CUSTOMER' ? advisor.travelsToCustomers : advisor.inPerson !== false;
    if (!ok) excluded.push({ advisorId: advisor.id, name: advisor.name, reason: `does not offer ${type.meetingFormat.toLowerCase().replace(/_/g, ' ')} meetings` });
    return ok;
  });

  let measures = new Map<string, GeoMeasure>();
  let routing: SearchResult['routing'] = 'NOT_NEEDED';
  if (needsLocation(type)) {
    if (!customer) throw Object.assign(new Error('A location is needed for this appointment type.'), { code: 'LOCATION_REQUIRED' });
    const measured = await measureAdvisors(advisors, customer.point);
    measures = measured.measures;
    routing = measured.routed ? 'ROAD' : 'STRAIGHT_LINE';
    if (type.distanceBasis === 'STRAIGHT_LINE') for (const measure of measures.values()) measure.roadKm = null;
    advisors = advisors.filter((advisor) => {
      const geoAdvisor = {
        advisorId: advisor.id,
        base: advisorPoint(advisor),
        serviceRadiusKm: advisor.serviceRadiusKm,
        maxTravelMinutes: advisor.maxTravelMinutes,
        serviceArea: parseServiceArea(advisor.serviceArea),
        postcodeTerritory: advisor.postcodeTerritory ? advisor.postcodeTerritory.split(',').map((entry) => entry.trim()).filter(Boolean) : [],
      };
      const measure = measures.get(advisor.id) ?? { straightKm: null, roadKm: null, travelMinutes: null, routed: false };
      const verdict = geoEligibility(geoAdvisor, customer.point, customer.postcode, measure, type.locationMode === 'NONE' ? 'WITHIN_RADIUS' : type.locationMode);
      if (!verdict.eligible) excluded.push({ advisorId: advisor.id, name: advisor.name, reason: verdict.reason });
      return verdict.eligible;
    });
  }

  const ids = advisors.map((advisor) => advisor.id);
  const [reserved, bookings] = await Promise.all([
    reservedIntervals(ids, window.from - DAY, window.to + DAY, ignore?.appointmentId ?? null),
    appointmentsFor(ids, window.from - 8 * DAY, window.to + 8 * DAY),
  ]);

  const capacity = Math.max(1, type.capacity ?? 1);
  const results: AdvisorAvailability[] = [];
  for (const advisor of advisors) {
    const computed = await advisorStarts(advisor, type, window, reserved.get(advisor.id) ?? [], bookings, now, customer, settings.defaultTimeZone, ignore);
    if (computed.failures.length > 0) excluded.push({ advisorId: advisor.id, name: advisor.name, reason: computed.failures.join('; ') });

    // Group sessions with seats left stay bookable although the host is already held by the session.
    const sessions = new Map<number, { sessionKey: string; booked: number }>();
    if (capacity > 1) {
      for (const booking of bookings.filter((item) => item.advisorId === advisor.id && item.appointmentTypeId === type.id && item.sessionKey)) {
        const start = Date.parse(booking.startsAt);
        const session = sessions.get(start) ?? { sessionKey: booking.sessionKey, booked: 0 };
        session.booked += 1;
        sessions.set(start, session);
      }
      for (const [start, session] of sessions)
        if (session.booked < capacity && start >= now + (type.minimumNoticeMinutes ?? 0) * MINUTE && start >= window.from && start < window.to && !computed.starts.includes(start))
          computed.starts.push(start);
      computed.starts.sort((a, b) => a - b);
    }
    results.push({ advisor, starts: computed.failures.length > 0 ? [] : computed.starts, failures: computed.failures, measure: measures.get(advisor.id) ?? null, travel: computed.travel, sessions });
  }

  const duration = type.durationMinutes * MINUTE;
  const byStart = new Map<number, string[]>();
  for (const result of results) for (const start of result.starts) byStart.set(start, [...(byStart.get(start) ?? []), result.advisor.id]);
  let starts = [...byStart.keys()].sort((a, b) => a - b);
  if (type.assignment === 'COLLECTIVE') {
    const everyone = results.map((result) => result.advisor.id);
    starts = everyone.length > 0 && results.every((result) => result.failures.length === 0) ? starts.filter((start) => byStart.get(start)?.length === everyone.length) : [];
  }
  const slots = starts.map((start) => {
    const sessionSeats = results
      .map((result) => result.sessions.get(start))
      .filter((session): session is { sessionKey: string; booked: number } => Boolean(session))
      .reduce((max, session) => Math.max(max, capacity - session.booked), 0);
    return { start, end: start + duration, advisorIds: byStart.get(start) ?? [], seatsLeft: capacity > 1 ? sessionSeats || capacity : null };
  });
  return { slots, advisors: rankByLocation(results.map((result) => ({ ...result, earliestStart: result.starts[0] ?? null, measure: result.measure ?? { straightKm: null, roadKm: null, travelMinutes: null, routed: false } })), type.locationMode === 'FASTEST' ? 'FASTEST' : type.locationMode === 'FIRST_AVAILABLE_NEARBY' ? 'FIRST_AVAILABLE_NEARBY' : 'NEAREST'), excluded, routing };
};
