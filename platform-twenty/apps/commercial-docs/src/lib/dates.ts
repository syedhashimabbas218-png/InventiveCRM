import { type RecurrenceFrequency } from 'src/constants/enums';

// Dates are plain YYYY-MM-DD strings in UK local time, matching Twenty DATE fields.
export const todayInLondon = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now);

const parse = (date: string): Date => new Date(`${date}T00:00:00Z`);
const format = (date: Date): string => date.toISOString().slice(0, 10);

export const addDays = (date: string, days: number): string => {
  const result = parse(date);
  result.setUTCDate(result.getUTCDate() + days);
  return format(result);
};

// Keeps the day of month where possible and clamps to month end (31 Jan + 1 month = 28/29 Feb).
export const addMonths = (date: string, months: number): string => {
  const start = parse(date);
  const day = start.getUTCDate();
  const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return format(target);
};

export const nextRecurrenceDate = (date: string, frequency: RecurrenceFrequency, interval: number): string => {
  const step = Math.max(1, Math.floor(interval || 1));
  switch (frequency) {
    case 'WEEKLY':
      return addDays(date, 7 * step);
    case 'MONTHLY':
      return addMonths(date, step);
    case 'QUARTERLY':
      return addMonths(date, 3 * step);
    case 'YEARLY':
      return addMonths(date, 12 * step);
  }
};

export const formatUkDate = (date: string | null | undefined): string => {
  if (!date) return '';
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
};
