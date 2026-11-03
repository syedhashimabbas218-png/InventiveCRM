// Wall-clock conversions through the IANA database (Intl). All stored times are UTC epoch milliseconds.
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const formatters = new Map<string, Intl.DateTimeFormat>();
const formatterFor = (timeZone: string) => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

export const isValidTimeZone = (timeZone: string) => {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
};

const wallParts = (utcMs: number, timeZone: string) => {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(new Date(utcMs)).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
};

export const offsetMs = (utcMs: number, timeZone: string) => {
  const wall = wallParts(utcMs, timeZone);
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - (utcMs - (utcMs % 1000));
};

const parseDate = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
};

export const parseTime = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
};

// A wall time skipped by a spring-forward change resolves to the instant after the gap; an ambiguous autumn
// time resolves to its first occurrence.
export const zonedToUtc = (date: string, time: string, timeZone: string): number => {
  const { year, month, day } = parseDate(date);
  const minutes = parseTime(time);
  const naive = Date.UTC(year, month - 1, day) + minutes * MINUTE;
  const candidates = [naive - offsetMs(naive - 12 * HOUR, timeZone), naive - offsetMs(naive + 12 * HOUR, timeZone)];
  const exact = candidates.filter((candidate) => {
    const wall = utcToZoned(candidate, timeZone);
    return wall.date === date && wall.minutes === minutes % (24 * 60);
  });
  return exact.length > 0 ? Math.min(...exact) : candidates[0];
};

export const utcToZoned = (utcMs: number, timeZone: string) => {
  const wall = wallParts(utcMs, timeZone);
  const date = `${wall.year}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`;
  return {
    date,
    time: `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`,
    minutes: wall.hour * 60 + wall.minute,
    weekday: weekdayOf(date),
  };
};

export const addDays = (date: string, days: number) => {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

export const weekdayOf = (date: string): Weekday => {
  const { year, month, day } = parseDate(date);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
};

// ISO week key (e.g. 2026-W45) for weekly booking limits, computed on the local date.
export const isoWeekKey = (date: string) => {
  const { year, month, day } = parseDate(date);
  const target = new Date(Date.UTC(year, month - 1, day));
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / DAY - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};
