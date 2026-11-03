import { type Interval } from 'src/engine/availability';

export type CalendarSummary = { id: string; name: string; primary: boolean; canWrite: boolean };

export type CalendarEventInput = {
  // Deterministic per appointment, so a retried create cannot make a second event.
  idempotencyKey: string;
  title: string;
  description: string;
  start: number;
  end: number;
  timeZone: string;
  location: string | null;
  attendees: { email: string; name: string }[];
  conference: 'GOOGLE_MEET' | 'MICROSOFT_TEAMS' | null;
};

export type CalendarEventResult = { id: string; meetingUrl: string | null; version: string | null };

export type ExternalEventState = { exists: boolean; cancelled: boolean; start: number | null; end: number | null; version: string | null };

export type CalendarAdapter = {
  listCalendars(): Promise<CalendarSummary[]>;
  busy(calendarIds: string[], from: number, to: number): Promise<Interval[]>;
  createEvent(calendarId: string, event: CalendarEventInput): Promise<CalendarEventResult>;
  updateEvent(calendarId: string, eventId: string, event: CalendarEventInput): Promise<CalendarEventResult>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
  getEvent(calendarId: string, eventId: string): Promise<ExternalEventState>;
};

// Auth problems need the user to reconnect; anything else is retried.
export class CalendarAuthError extends Error {}
export class CalendarRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export const providerFetch = async (url: string, accessToken: string, init: RequestInit & { prefer?: string } = {}) => {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 401 || response.status === 403) {
    const text = await response.text();
    throw new CalendarAuthError(`Calendar provider refused access (${response.status}): ${text.slice(0, 200)}`);
  }
  return response;
};

export const expectOk = async (response: Response, what: string) => {
  if (response.ok) return response;
  const text = await response.text();
  throw new CalendarRequestError(`${what} failed (${response.status}): ${text.slice(0, 200)}`, response.status, response.status === 429 || response.status >= 500);
};
