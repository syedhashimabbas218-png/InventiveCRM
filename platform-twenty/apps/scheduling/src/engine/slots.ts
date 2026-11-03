import { type Interval, overlaps } from 'src/engine/availability';
import { DAY, isoWeekKey, MINUTE, utcToZoned } from 'src/engine/time';

export type SlotRules = {
  durationMinutes: number;
  incrementMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  horizonDays: number;
  dailyLimit?: number | null;
  weeklyLimit?: number | null;
};

export type SlotInput = {
  rules: SlotRules;
  working: Interval[];
  // Busy time already including each existing booking's buffers, external calendar busy time and reservations.
  busy: Interval[];
  timeZone: string;
  now: number;
  // Bookings of this appointment type already held, by local date and ISO week, for the booking limits.
  bookedPerDay?: Record<string, number>;
  bookedPerWeek?: Record<string, number>;
};

// Starts where the meeting fits inside working time and the meeting plus its buffers clears every busy period.
export const generateSlots = ({ rules, working, busy, timeZone, now, bookedPerDay = {}, bookedPerWeek = {} }: SlotInput): number[] => {
  const duration = rules.durationMinutes * MINUTE;
  const increment = Math.max(5, rules.incrementMinutes || rules.durationMinutes) * MINUTE;
  const earliest = now + rules.minimumNoticeMinutes * MINUTE;
  const latest = now + rules.horizonDays * DAY;
  const slots: number[] = [];
  for (const window of working) {
    const local = utcToZoned(window.start, timeZone);
    const misalignment = (local.minutes * MINUTE) % increment;
    let start = window.start + (misalignment === 0 ? 0 : increment - misalignment);
    for (; start + duration <= window.end; start += increment) {
      if (start < earliest || start > latest) continue;
      const held = { start: start - rules.bufferBeforeMinutes * MINUTE, end: start + duration + rules.bufferAfterMinutes * MINUTE };
      if (busy.some((period) => overlaps(period, held))) continue;
      const date = utcToZoned(start, timeZone).date;
      if (rules.dailyLimit && (bookedPerDay[date] ?? 0) >= rules.dailyLimit) continue;
      if (rules.weeklyLimit && (bookedPerWeek[isoWeekKey(date)] ?? 0) >= rules.weeklyLimit) continue;
      slots.push(start);
    }
  }
  return [...new Set(slots)].sort((a, b) => a - b);
};

export const countBookings = (starts: number[], timeZone: string) => {
  const perDay: Record<string, number> = {};
  const perWeek: Record<string, number> = {};
  for (const start of starts) {
    const date = utcToZoned(start, timeZone).date;
    perDay[date] = (perDay[date] ?? 0) + 1;
    perWeek[isoWeekKey(date)] = (perWeek[isoWeekKey(date)] ?? 0) + 1;
  }
  return { perDay, perWeek };
};

// Reservation keys: one per advisor per tick the booking holds (buffers included). A unique index on the key makes
// two overlapping bookings for the same advisor impossible, whatever their start times.
export const RESERVATION_TICK_MINUTES = 5;

export const reservationKeys = (advisorId: string, held: Interval) => {
  const tick = RESERVATION_TICK_MINUTES * MINUTE;
  const keys: string[] = [];
  for (let at = Math.floor(held.start / tick) * tick; at < held.end; at += tick) keys.push(`${advisorId}|${new Date(at).toISOString()}`);
  return keys;
};

export const seatKey = (sessionKey: string, seat: number) => `${sessionKey}|seat-${seat}`;
