import { MINUTE } from 'src/engine/time';

export const reminderIntervals = (value: string | null | undefined) =>
  (value ?? '')
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((minutes) => Number.isFinite(minutes) && minutes > 0);

// Nothing further ahead than the longest interval of any type can be due, so the scan stops there.
export const largestReminderMinutes = (values: (string | null | undefined)[]) => values.flatMap(reminderIntervals).reduce((largest, minutes) => Math.max(largest, minutes), 0);

// Each interval is sent once; if several fall due together (for example after downtime) one email covers them.
export const dueReminderIntervals = (reminderMinutes: string | null | undefined, remindersSent: string | null | undefined, start: number, now: number) => {
  const done = new Set(reminderIntervals(remindersSent));
  return reminderIntervals(reminderMinutes).filter((minutes) => !done.has(minutes) && now >= start - minutes * MINUTE);
};

export const withRemindersSent = (remindersSent: string | null | undefined, due: number[]) =>
  [...new Set([...reminderIntervals(remindersSent), ...due])].sort((a, b) => b - a).join(',');
