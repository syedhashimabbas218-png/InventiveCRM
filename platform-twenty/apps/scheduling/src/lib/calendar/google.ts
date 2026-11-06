import { createHash } from 'node:crypto';

import { type Interval } from 'src/engine/availability';
import {
  type CalendarAdapter,
  type CalendarEventInput,
  type CalendarEventResult,
  CalendarRequestError,
  expectOk,
  providerFetch,
} from 'src/lib/calendar/types';

type GoogleEvent = {
  id: string;
  status?: string;
  updated?: string;
  etag?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] };
};

// Google event ids allow only lowercase base32hex (a-v, 0-9), 5 to 1024 characters.
export const googleEventId = (key: string) =>
  BigInt(`0x${createHash('sha256').update(key).digest('hex').slice(0, 40)}`)
    .toString(32)
    .padStart(5, '0');

const body = (event: CalendarEventInput, withId: boolean) => ({
  ...(withId ? { id: googleEventId(event.idempotencyKey) } : {}),
  summary: event.title,
  description: event.description,
  location: event.location ?? undefined,
  start: { dateTime: new Date(event.start).toISOString(), timeZone: event.timeZone },
  end: { dateTime: new Date(event.end).toISOString(), timeZone: event.timeZone },
  attendees: event.attendees.map((attendee) => ({ email: attendee.email, displayName: attendee.name })),
  ...(event.conference === 'GOOGLE_MEET'
    ? { conferenceData: { createRequest: { requestId: event.idempotencyKey.slice(0, 64), conferenceSolutionKey: { type: 'hangoutsMeet' } } } }
    : {}),
  reminders: { useDefault: true },
});

const result = (event: GoogleEvent): CalendarEventResult => ({
  id: event.id,
  meetingUrl: event.hangoutLink ?? event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri ?? null,
  version: event.updated ?? event.etag ?? null,
});

export const googleCalendar = (accessToken: string, baseUrl = process.env.GOOGLE_CALENDAR_API_URL || 'https://www.googleapis.com/calendar/v3'): CalendarAdapter => {
  const url = (path: string) => `${baseUrl.replace(/\/$/, '')}${path}`;
  const calendarPath = (calendarId: string) => `/calendars/${encodeURIComponent(calendarId)}/events`;

  return {
    async listCalendars() {
      const response = await expectOk(await providerFetch(url('/users/me/calendarList?minAccessRole=freeBusyReader'), accessToken), 'Google calendar list');
      const data = (await response.json()) as { items?: { id: string; summary: string; primary?: boolean; accessRole: string }[] };
      return (data.items ?? []).map((item) => ({
        id: item.id,
        name: item.summary,
        primary: Boolean(item.primary),
        // calendar.events.owned only allows writing to calendars the user owns.
        canWrite: item.accessRole === 'owner',
      }));
    },

    // Only busy blocks come back from free/busy: no titles or descriptions of private events.
    async busy(calendarIds, from, to) {
      if (calendarIds.length === 0) return [];
      const response = await expectOk(
        await providerFetch(url('/freeBusy'), accessToken, {
          method: 'POST',
          body: JSON.stringify({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), items: calendarIds.map((id) => ({ id })) }),
        }),
        'Google free/busy',
      );
      const data = (await response.json()) as { calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason: string }[] }> };
      const intervals: Interval[] = [];
      for (const [calendarId, calendar] of Object.entries(data.calendars ?? {})) {
        if (calendar.errors?.length) throw new CalendarRequestError(`Google free/busy for ${calendarId}: ${calendar.errors.map((error) => error.reason).join(', ')}`, 502, true);
        for (const block of calendar.busy ?? []) intervals.push({ start: Date.parse(block.start), end: Date.parse(block.end) });
      }
      return intervals;
    },

    async createEvent(calendarId, event) {
      const response = await providerFetch(url(`${calendarPath(calendarId)}?conferenceDataVersion=1&sendUpdates=none`), accessToken, {
        method: 'POST',
        body: JSON.stringify(body(event, true)),
      });
      // 409: an earlier attempt already created it (same deterministic id), so update that one instead.
      if (response.status === 409) return this.updateEvent(calendarId, googleEventId(event.idempotencyKey), event);
      return result((await (await expectOk(response, 'Google event create')).json()) as GoogleEvent);
    },

    async updateEvent(calendarId, eventId, event) {
      const response = await expectOk(
        await providerFetch(url(`${calendarPath(calendarId)}/${encodeURIComponent(eventId)}?conferenceDataVersion=1&sendUpdates=none`), accessToken, {
          method: 'PATCH',
          body: JSON.stringify({ ...body(event, false), status: 'confirmed' }),
        }),
        'Google event update',
      );
      return result((await response.json()) as GoogleEvent);
    },

    async deleteEvent(calendarId, eventId) {
      const response = await providerFetch(url(`${calendarPath(calendarId)}/${encodeURIComponent(eventId)}?sendUpdates=none`), accessToken, { method: 'DELETE' });
      if (response.status === 404 || response.status === 410) return;
      await expectOk(response, 'Google event delete');
    },

    async getEvent(calendarId, eventId) {
      const response = await providerFetch(url(`${calendarPath(calendarId)}/${encodeURIComponent(eventId)}`), accessToken);
      if (response.status === 404 || response.status === 410) return { exists: false, cancelled: true, start: null, end: null, version: null };
      const event = (await (await expectOk(response, 'Google event read')).json()) as GoogleEvent;
      return {
        exists: true,
        cancelled: event.status === 'cancelled',
        start: event.start?.dateTime ? Date.parse(event.start.dateTime) : null,
        end: event.end?.dateTime ? Date.parse(event.end.dateTime) : null,
        version: event.updated ?? null,
      };
    },
  };
};
