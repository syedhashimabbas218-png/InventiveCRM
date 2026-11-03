const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export type Weekday = (typeof WEEKDAYS)[number];
export type OpeningHours = Partial<Record<Weekday, [string, string][]>>;

const localParts = (at: Date, timezone: string): { weekday: Weekday; minutes: number } => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const weekday = value('weekday').toLowerCase().slice(0, 3) as Weekday;
  return { weekday, minutes: Number(value('hour')) * 60 + Number(value('minute')) };
};

const toMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};

export const isOpenAt = (openingHours: OpeningHours, timezone: string, at: Date): boolean => {
  const { weekday, minutes } = localParts(at, timezone);
  return (openingHours[weekday] ?? []).some(
    ([opens, closes]) => minutes >= toMinutes(opens) && minutes < toMinutes(closes),
  );
};

export const graceMinutesAt = (
  settings: { opening_hours: OpeningHours; timezone: string; grace_minutes_open: number; grace_minutes_closed: number },
  at: Date,
): number =>
  isOpenAt(settings.opening_hours, settings.timezone, at) ? settings.grace_minutes_open : settings.grace_minutes_closed;
