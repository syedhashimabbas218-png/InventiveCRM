import { describe, expect, it } from 'vitest';

import { pickAdvisor, rankCandidates, type AssignmentCandidate } from 'src/engine/assignment';
import { intersectIntervals, mergeIntervals, subtractIntervals, workingIntervals } from 'src/engine/availability';
import { geoEligibility, haversineKm, inServiceArea, postcodeInTerritory, rankByLocation, type GeoAdvisor } from 'src/engine/geo';
import { countBookings, generateSlots, reservationKeys } from 'src/engine/slots';
import { addDays, DAY, isoWeekKey, MINUTE, utcToZoned, zonedToUtc } from 'src/engine/time';
import { fallbackTravelMinutes, neighbouringStops, travelFeasibility } from 'src/engine/travel';

const iso = (ms: number) => new Date(ms).toISOString();
const LONDON = 'Europe/London';

describe('time zones and daylight saving', () => {
  it('converts London wall time in winter and summer', () => {
    expect(iso(zonedToUtc('2026-01-15', '09:00', LONDON))).toBe('2026-01-15T09:00:00.000Z');
    expect(iso(zonedToUtc('2026-07-15', '09:00', LONDON))).toBe('2026-07-15T08:00:00.000Z');
    expect(iso(zonedToUtc('2026-07-15', '09:00', 'America/New_York'))).toBe('2026-07-15T13:00:00.000Z');
    expect(iso(zonedToUtc('2026-07-15', '09:00', 'Asia/Kolkata'))).toBe('2026-07-15T03:30:00.000Z');
  });

  it('moves a time skipped in spring forward and takes the first of a repeated autumn time', () => {
    expect(iso(zonedToUtc('2026-03-29', '01:30', LONDON))).toBe('2026-03-29T01:30:00.000Z');
    expect(utcToZoned(zonedToUtc('2026-03-29', '01:30', LONDON), LONDON).time).toBe('02:30');
    expect(iso(zonedToUtc('2026-10-25', '01:30', LONDON))).toBe('2026-10-25T00:30:00.000Z');
  });

  it('round-trips and walks dates', () => {
    const at = zonedToUtc('2026-10-24', '23:45', LONDON);
    expect(utcToZoned(at, LONDON)).toMatchObject({ date: '2026-10-24', time: '23:45', weekday: 'sat' });
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01');
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53');
  });
});

describe('availability', () => {
  const rules = { mon: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }], tue: [{ start: '22:00', end: '02:00' }] };
  const monday = zonedToUtc('2026-11-02', '00:00', LONDON);

  it('builds working time with breaks and windows that cross midnight', () => {
    const intervals = workingIntervals({ rules, timeZone: LONDON, from: monday, to: monday + 3 * DAY });
    expect(intervals.map((interval) => [iso(interval.start), iso(interval.end)])).toEqual([
      ['2026-11-02T09:00:00.000Z', '2026-11-02T12:00:00.000Z'],
      ['2026-11-02T13:00:00.000Z', '2026-11-02T17:00:00.000Z'],
      ['2026-11-03T22:00:00.000Z', '2026-11-04T02:00:00.000Z'],
    ]);
  });

  it('applies holidays, custom hours and part-day time off', () => {
    const intervals = workingIntervals({
      rules,
      timeZone: LONDON,
      from: monday,
      to: monday + 8 * DAY,
      overrides: [
        { startDate: '2026-11-03', endDate: '2026-11-03', kind: 'UNAVAILABLE' },
        { startDate: '2026-11-09', endDate: '2026-11-09', kind: 'UNAVAILABLE', windows: [{ start: '14:00', end: '15:00' }] },
        { startDate: '2026-11-07', endDate: '2026-11-07', kind: 'CUSTOM_HOURS', windows: [{ start: '10:00', end: '11:00' }] },
      ],
    });
    const days = intervals.map((interval) => `${utcToZoned(interval.start, LONDON).date} ${utcToZoned(interval.start, LONDON).time}-${utcToZoned(interval.end, LONDON).time}`);
    expect(days).toEqual(['2026-11-02 09:00-12:00', '2026-11-02 13:00-17:00', '2026-11-07 10:00-11:00', '2026-11-09 09:00-12:00', '2026-11-09 13:00-14:00', '2026-11-09 15:00-17:00']);
  });

  it('keeps local hours across the clock change', () => {
    const intervals = workingIntervals({ rules: { mon: [{ start: '09:00', end: '10:00' }] }, timeZone: LONDON, from: zonedToUtc('2026-10-19', '00:00', LONDON), to: zonedToUtc('2026-10-27', '00:00', LONDON) });
    expect(intervals.map((interval) => iso(interval.start))).toEqual(['2026-10-19T08:00:00.000Z', '2026-10-26T09:00:00.000Z']);
  });

  it('merges, subtracts and intersects', () => {
    expect(mergeIntervals([{ start: 0, end: 5 }, { start: 3, end: 8 }, { start: 10, end: 12 }])).toEqual([{ start: 0, end: 8 }, { start: 10, end: 12 }]);
    expect(subtractIntervals([{ start: 0, end: 10 }], [{ start: 2, end: 3 }, { start: 5, end: 12 }])).toEqual([{ start: 0, end: 2 }, { start: 3, end: 5 }]);
    expect(intersectIntervals([{ start: 0, end: 10 }], [{ start: 5, end: 15 }])).toEqual([{ start: 5, end: 10 }]);
  });
});

describe('slots', () => {
  const day = '2026-11-02';
  const working = [{ start: zonedToUtc(day, '09:00', LONDON), end: zonedToUtc(day, '12:00', LONDON) }];
  const rules = { durationMinutes: 30, incrementMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, minimumNoticeMinutes: 0, horizonDays: 60 };
  const now = zonedToUtc('2026-11-01', '12:00', LONDON);
  const times = (slots: number[]) => slots.map((slot) => utcToZoned(slot, LONDON).time);

  it('fills working time at the increment, minus busy time and buffers', () => {
    expect(times(generateSlots({ rules, working, busy: [], timeZone: LONDON, now }))).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
    const busy = [{ start: zonedToUtc(day, '10:00', LONDON), end: zonedToUtc(day, '10:30', LONDON) }];
    expect(times(generateSlots({ rules: { ...rules, bufferAfterMinutes: 15, incrementMinutes: 15 }, working, busy, timeZone: LONDON, now }))).toEqual(['09:00', '09:15', '10:30', '10:45', '11:00', '11:15', '11:30']);
  });

  it('respects notice, horizon and daily limits', () => {
    expect(times(generateSlots({ rules: { ...rules, minimumNoticeMinutes: 60 }, working, busy: [], timeZone: LONDON, now: zonedToUtc(day, '09:40', LONDON) }))).toEqual(['11:00', '11:30']);
    expect(generateSlots({ rules: { ...rules, horizonDays: 0 }, working, busy: [], timeZone: LONDON, now })).toEqual([]);
    const counts = countBookings([zonedToUtc(day, '08:00', LONDON)], LONDON);
    expect(generateSlots({ rules: { ...rules, dailyLimit: 1 }, working, busy: [], timeZone: LONDON, now, bookedPerDay: counts.perDay })).toEqual([]);
  });

  it('gives overlapping bookings shared reservation keys whatever their start times', () => {
    const first = reservationKeys('a', { start: zonedToUtc(day, '09:00', LONDON), end: zonedToUtc(day, '10:00', LONDON) });
    const second = reservationKeys('a', { start: zonedToUtc(day, '09:45', LONDON), end: zonedToUtc(day, '10:15', LONDON) });
    const adjacent = reservationKeys('a', { start: zonedToUtc(day, '10:00', LONDON), end: zonedToUtc(day, '10:30', LONDON) });
    expect(first.filter((key) => second.includes(key)).length).toBeGreaterThan(0);
    expect(first.filter((key) => adjacent.includes(key))).toEqual([]);
    expect(first).toHaveLength(12);
  });
});

describe('round robin', () => {
  const candidate = (advisorId: string, overrides: Partial<AssignmentCandidate> = {}): AssignmentCandidate => ({
    advisorId,
    name: advisorId,
    weight: 1,
    priority: 0,
    assignedCount: 0,
    lastAssignedAt: null,
    upcomingBookedMinutes: 0,
    ...overrides,
  });

  it('distributes equally and stays fair over many bookings', () => {
    const pool = [candidate('a'), candidate('b'), candidate('c')];
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let booking = 0; booking < 30; booking += 1) {
      const pick = pickAdvisor(pool, 'EQUAL');
      const winner = pool.find((item) => item.advisorId === pick?.winner.advisorId)!;
      winner.assignedCount += 1;
      winner.lastAssignedAt = booking;
      counts[winner.advisorId] += 1;
    }
    expect(counts).toEqual({ a: 10, b: 10, c: 10 });
  });

  it('follows weights over time', () => {
    const pool = [candidate('a', { weight: 3 }), candidate('b', { weight: 1 })];
    const counts: Record<string, number> = { a: 0, b: 0 };
    for (let booking = 0; booking < 40; booking += 1) {
      const winner = pool.find((item) => item.advisorId === pickAdvisor(pool, 'WEIGHTED')?.winner.advisorId)!;
      winner.assignedCount += 1;
      winner.lastAssignedAt = booking;
      counts[winner.advisorId] += 1;
    }
    expect(counts).toEqual({ a: 30, b: 10 });
  });

  it('ranks by recency, workload, priority and earliest availability', () => {
    expect(rankCandidates([candidate('a', { lastAssignedAt: 5 }), candidate('b', { lastAssignedAt: 2 })], 'LEAST_RECENT')[0].advisorId).toBe('b');
    expect(rankCandidates([candidate('a', { upcomingBookedMinutes: 300 }), candidate('b', { upcomingBookedMinutes: 60 })], 'LEAST_BOOKED')[0].advisorId).toBe('b');
    expect(rankCandidates([candidate('a', { priority: 1 }), candidate('b', { priority: 9 })], 'PRIORITY')[0].advisorId).toBe('b');
    expect(rankCandidates([candidate('a', { earliestStart: 50 }), candidate('b', { earliestStart: 10 })], 'FIRST_AVAILABLE')[0].advisorId).toBe('b');
    expect(pickAdvisor([], 'EQUAL')).toBeNull();
  });
});

describe('geography', () => {
  const leeds = { lat: 53.7997, lng: -1.5492 };
  const headingley = { lat: 53.8188, lng: -1.5784 };
  const york = { lat: 53.959, lng: -1.0815 };
  const square = { type: 'Polygon' as const, coordinates: [[[-1.6, 53.78], [-1.5, 53.78], [-1.5, 53.83], [-1.6, 53.83], [-1.6, 53.78]] as [number, number][]] };
  const advisor = (overrides: Partial<GeoAdvisor> = {}): GeoAdvisor => ({ advisorId: 'a', base: leeds, serviceRadiusKm: null, maxTravelMinutes: null, serviceArea: null, postcodeTerritory: [], ...overrides });
  const measure = (straightKm: number, travelMinutes: number | null = null) => ({ straightKm, roadKm: null, travelMinutes, routed: travelMinutes !== null });

  it('measures distance and service areas', () => {
    expect(haversineKm(leeds, york)).toBeGreaterThan(34);
    expect(haversineKm(leeds, york)).toBeLessThan(37);
    expect(inServiceArea(headingley, square)).toBe(true);
    expect(inServiceArea(york, square)).toBe(false);
    expect(postcodeInTerritory('LS6 2AB', ['LS6'])).toBe(true);
    expect(postcodeInTerritory('LS60 1AA', ['LS6'])).toBe(false);
    expect(postcodeInTerritory('ls1 4dy', ['LS'])).toBe(true);
    expect(postcodeInTerritory('L1 8JQ', ['LS'])).toBe(false);
  });

  it('decides eligibility by radius, travel time and territory', () => {
    expect(geoEligibility(advisor({ serviceRadiusKm: 10 }), york, null, measure(34), 'WITHIN_RADIUS').eligible).toBe(false);
    expect(geoEligibility(advisor({ serviceRadiusKm: 10 }), headingley, null, measure(3), 'WITHIN_RADIUS').eligible).toBe(true);
    expect(geoEligibility(advisor({ maxTravelMinutes: 20 }), york, null, measure(34, 45), 'NEAREST').eligible).toBe(false);
    expect(geoEligibility(advisor({ serviceArea: square }), headingley, null, measure(3), 'TERRITORY').eligible).toBe(true);
    expect(geoEligibility(advisor({ postcodeTerritory: ['YO'] }), york, 'YO1 7HH', measure(34), 'TERRITORY').eligible).toBe(true);
    expect(geoEligibility(advisor(), york, null, measure(34), 'TERRITORY').eligible).toBe(false);
  });

  it('ranks nearest, fastest and first available nearby', () => {
    const items = [
      { id: 'near-slow', measure: { straightKm: 2, roadKm: 3, travelMinutes: 25, routed: true }, earliestStart: 300 },
      { id: 'far-fast', measure: { straightKm: 5, roadKm: 6, travelMinutes: 9, routed: true }, earliestStart: 100 },
    ];
    expect(rankByLocation(items, 'NEAREST')[0].id).toBe('near-slow');
    expect(rankByLocation(items, 'FASTEST')[0].id).toBe('far-fast');
    expect(rankByLocation(items, 'FIRST_AVAILABLE_NEARBY')[0].id).toBe('far-fast');
  });
});

describe('travel-aware scheduling', () => {
  const at = (time: string) => zonedToUtc('2026-11-02', time, LONDON);
  const customer = { lat: 53.8188, lng: -1.5784 };
  const office = { lat: 53.7997, lng: -1.5492 };

  it('rejects slots the advisor cannot reach in time and accepts ones they can', () => {
    const bookings = [{ start: at('09:00'), end: at('10:00'), location: office }];
    const slot = { start: at('10:15'), end: at('11:00') };
    const { previous, next } = neighbouringStops(slot, bookings, { start: at('09:00') }, office);
    expect(travelFeasibility({ slot, previous, next, toCustomer: { minutes: 20, verified: true }, fromCustomer: null, bufferMinutes: 0 }).feasible).toBe(false);
    expect(travelFeasibility({ slot: { start: at('10:30'), end: at('11:00') }, previous, next, toCustomer: { minutes: 20, verified: true }, fromCustomer: null, bufferMinutes: 5 })).toMatchObject({ feasible: true, verified: true });
  });

  it('starts the day at base and marks estimates as unverified', () => {
    const slot = { start: at('09:00'), end: at('09:30') };
    const { previous } = neighbouringStops(slot, [], { start: at('09:00') }, office);
    expect(travelFeasibility({ slot, previous, next: null, toCustomer: { minutes: 10, verified: true }, fromCustomer: null, bufferMinutes: 0 }).feasible).toBe(false);
    const estimate = fallbackTravelMinutes(office, customer);
    expect(estimate).toBeGreaterThan(4);
    const later = { start: at('10:00'), end: at('10:30') };
    expect(travelFeasibility({ slot: later, previous, next: null, toCustomer: { minutes: estimate, verified: false }, fromCustomer: null, bufferMinutes: 0 })).toMatchObject({ feasible: true, verified: false });
    expect(MINUTE).toBe(60000);
  });
});
