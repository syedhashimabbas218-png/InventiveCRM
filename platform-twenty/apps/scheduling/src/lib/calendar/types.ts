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

// Auth problems need the user to reconnect; anything else is retried or reported.
export class CalendarAuthError extends Error {}
// A permission the feature needs was not granted on the consent screen; reconnecting lets the user grant it.
export class CalendarPermissionError extends CalendarAuthError {}
export class CalendarRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }
}

type ProviderErrorBody = {
  error?: {
    code?: number | string;
    message?: string;
    status?: string;
    errors?: { reason?: string }[];
    details?: { reason?: string }[];
  };
};

const GOOGLE_RATE_LIMIT_REASONS = ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded'];
const GOOGLE_SCOPE_REASONS = ['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'];
const GRAPH_PERMISSION_CODES = ['ErrorAccessDenied', 'Authorization_RequestDenied', 'AccessDenied'];
const GRAPH_NO_MAILBOX_CODES = ['MailboxNotEnabledForRESTAPI', 'MailboxNotSupportedForRESTAPI', 'ErrorMailboxNotEnabledForRESTAPI'];

// Seconds or an HTTP date, as both Google and Microsoft Graph may send.
export const parseRetryAfter = (value: string | null, now = Date.now()): number | null => {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
};

const parseErrorBody = (text: string): ProviderErrorBody => {
  try {
    return JSON.parse(text) as ProviderErrorBody;
  } catch {
    return {};
  }
};

// Turns a refused provider call into the right kind of error, or null when the caller should handle the status itself.
export const classifyProviderFailure = (status: number, text: string, retryAfterMs: number | null): Error | null => {
  const error = parseErrorBody(text).error ?? {};
  const reasons = [...(error.errors ?? []), ...(error.details ?? [])].map((entry) => entry.reason ?? '');
  const code = typeof error.code === 'string' ? error.code : '';
  const detail = (error.message ?? text).slice(0, 200);

  if (GRAPH_NO_MAILBOX_CODES.includes(code))
    return new CalendarRequestError('This Microsoft account has no Exchange Online mailbox, so it has no Outlook calendar to use. Connect a Microsoft 365 or Outlook.com account instead.', status, false);
  if (status === 429 || reasons.some((reason) => GOOGLE_RATE_LIMIT_REASONS.includes(reason)))
    return new CalendarRequestError(`The calendar provider asked us to slow down (${status}): ${detail}`, status, true, retryAfterMs);
  if (reasons.some((reason) => GOOGLE_SCOPE_REASONS.includes(reason)) || GRAPH_PERMISSION_CODES.includes(code))
    return new CalendarPermissionError(`The calendar account did not grant a permission this needs. Reconnect it and allow every calendar permission asked for. (${detail})`);
  if (status === 401) return new CalendarAuthError(`Calendar provider refused access (401): ${detail}`);
  if (status === 403) return new CalendarRequestError(`The calendar provider refused this request (403): ${detail}`, status, false);
  return null;
};

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
  if (response.ok) return response;
  const failure = classifyProviderFailure(response.status, await response.clone().text(), parseRetryAfter(response.headers.get('Retry-After')));
  if (failure) throw failure;
  return response;
};

export const expectOk = async (response: Response, what: string) => {
  if (response.ok) return response;
  const text = await response.text();
  throw new CalendarRequestError(
    `${what} failed (${response.status}): ${text.slice(0, 200)}`,
    response.status,
    response.status === 429 || response.status >= 500,
    parseRetryAfter(response.headers.get('Retry-After')),
  );
};
