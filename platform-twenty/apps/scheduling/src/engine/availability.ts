import { addDays, MINUTE, parseTime, utcToZoned, type Weekday, weekdayOf, zonedToUtc } from 'src/engine/time';

export type Interval = { start: number; end: number };
export type TimeWindow = { start: string; end: string };
export type WeeklyRules = Partial<Record<Weekday, TimeWindow[]>>;

// CUSTOM_HOURS replaces the weekly hours on those dates; UNAVAILABLE removes the whole day, or only its windows.
export type AvailabilityOverride = {
  startDate: string;
  endDate: string;
  kind: 'CUSTOM_HOURS' | 'UNAVAILABLE';
  windows?: TimeWindow[] | null;
};

export const mergeIntervals = (intervals: Interval[]): Interval[] => {
  const sorted = intervals.filter((interval) => interval.end > interval.start).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
};

export const subtractIntervals = (base: Interval[], remove: Interval[]): Interval[] => {
  const blocked = mergeIntervals(remove);
  const result: Interval[] = [];
  for (const interval of mergeIntervals(base)) {
    let cursor = interval.start;
    for (const block of blocked) {
      if (block.end <= cursor || block.start >= interval.end) continue;
      if (block.start > cursor) result.push({ start: cursor, end: block.start });
      cursor = Math.max(cursor, block.end);
    }
    if (cursor < interval.end) result.push({ start: cursor, end: interval.end });
  }
  return result;
};

export const intersectIntervals = (first: Interval[], second: Interval[]): Interval[] => {
  const result: Interval[] = [];
  const a = mergeIntervals(first);
  const b = mergeIntervals(second);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const end = Math.min(a[i].end, b[j].end);
    if (start < end) result.push({ start, end });
    if (a[i].end < b[j].end) i += 1;
    else j += 1;
  }
  return result;
};

export const overlaps = (first: Interval, second: Interval) => first.start < second.end && second.start < first.end;

const windowToInterval = (date: string, window: TimeWindow, timeZone: string): Interval => {
  const crossesMidnight = window.end === '24:00' || parseTime(window.end) <= parseTime(window.start);
  const endDate = crossesMidnight ? addDays(date, 1) : date;
  const endTime = window.end === '24:00' ? '00:00' : window.end;
  return { start: zonedToUtc(date, window.start, timeZone), end: zonedToUtc(endDate, endTime, timeZone) };
};

const overridesOn = (overrides: AvailabilityOverride[], date: string) =>
  overrides.filter((override) => override.startDate <= date && date <= override.endDate);

// Working time between two instants, in UTC. Days are walked in the advisor's time zone, starting a day early so a
// window that crosses midnight from the previous day is included.
export const workingIntervals = ({
  rules,
  overrides = [],
  timeZone,
  from,
  to,
}: {
  rules: WeeklyRules;
  overrides?: AvailabilityOverride[];
  timeZone: string;
  from: number;
  to: number;
}): Interval[] => {
  const open: Interval[] = [];
  const closed: Interval[] = [];
  const lastDate = utcToZoned(to, timeZone).date;
  for (let date = addDays(utcToZoned(from, timeZone).date, -1); date <= lastDate; date = addDays(date, 1)) {
    const dayOverrides = overridesOn(overrides, date);
    const custom = dayOverrides.find((override) => override.kind === 'CUSTOM_HOURS');
    const windows = custom ? (custom.windows ?? []) : (rules[weekdayOf(date)] ?? []);
    const fullDayOff = dayOverrides.some((override) => override.kind === 'UNAVAILABLE' && !override.windows?.length);
    if (!fullDayOff) open.push(...windows.map((window) => windowToInterval(date, window, timeZone)));
    for (const override of dayOverrides)
      if (override.kind === 'UNAVAILABLE' && override.windows?.length)
        closed.push(...override.windows.map((window) => windowToInterval(date, window, timeZone)));
  }
  return intersectIntervals(subtractIntervals(open, closed), [{ start: from, end: to }]);
};

// Busy time an existing booking holds, including its own buffers.
export const heldInterval = (start: number, end: number, bufferBeforeMinutes: number, bufferAfterMinutes: number): Interval => ({
  start: start - bufferBeforeMinutes * MINUTE,
  end: end + bufferAfterMinutes * MINUTE,
});
