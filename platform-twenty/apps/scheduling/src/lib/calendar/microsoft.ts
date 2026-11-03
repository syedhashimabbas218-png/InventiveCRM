import { type Interval } from 'src/engine/availability';
import { type CalendarAdapter, type CalendarEventInput, type CalendarEventResult, expectOk, providerFetch } from 'src/lib/calendar/types';

type GraphEvent = {
  id: string;
  isCancelled?: boolean;
  showAs?: string;
  lastModifiedDateTime?: string;
  start?: { dateTime: string; timeZone: string };
  end?: { dateTime: string; timeZone: string };
  onlineMeeting?: { joinUrl?: string } | null;
};

// Graph returns times in the zone asked for with the Prefer header; asking for UTC keeps parsing exact.
const PREFER_UTC = 'outlook.timezone="UTC"';
const graphUtc = (value: string) => Date.parse(value.endsWith('Z') ? value : `${value}Z`);
const graphTime = (ms: number) => ({ dateTime: new Date(ms).toISOString().replace('Z', ''), timeZone: 'UTC' });

const body = (event: CalendarEventInput, create: boolean) => ({
  subject: event.title,
  body: { contentType: 'text', content: event.description },
  start: graphTime(event.start),
  end: graphTime(event.end),
  location: event.location ? { displayName: event.location } : undefined,
  attendees: event.attendees.map((attendee) => ({ emailAddress: { address: attendee.email, name: attendee.name }, type: 'required' })),
  ...(event.conference === 'MICROSOFT_TEAMS' ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' } : {}),
  ...(create ? { transactionId: event.idempotencyKey } : {}),
});

const result = (event: GraphEvent): CalendarEventResult => ({
  id: event.id,
  meetingUrl: event.onlineMeeting?.joinUrl ?? null,
  version: event.lastModifiedDateTime ?? null,
});

export const microsoftCalendar = (accessToken: string, baseUrl = process.env.MICROSOFT_GRAPH_API_URL || 'https://graph.microsoft.com/v1.0'): CalendarAdapter => {
  const url = (path: string) => `${baseUrl.replace(/\/$/, '')}${path}`;

  return {
    async listCalendars() {
      const response = await expectOk(await providerFetch(url('/me/calendars?$select=id,name,isDefaultCalendar,canEdit'), accessToken), 'Microsoft calendar list');
      const data = (await response.json()) as { value?: { id: string; name: string; isDefaultCalendar?: boolean; canEdit?: boolean }[] };
      return (data.value ?? []).map((item) => ({ id: item.id, name: item.name, primary: Boolean(item.isDefaultCalendar), canWrite: Boolean(item.canEdit) }));
    },

    // calendarView expands recurring events into their occurrences; only start, end and show-as are read.
    async busy(calendarIds, from, to) {
      const intervals: Interval[] = [];
      for (const calendarId of calendarIds) {
        let next: string | null = url(
          `/me/calendars/${encodeURIComponent(calendarId)}/calendarView?startDateTime=${new Date(from).toISOString()}&endDateTime=${new Date(to).toISOString()}&$select=start,end,showAs,isCancelled&$top=200`,
        );
        while (next) {
          const response = await expectOk(await providerFetch(next, accessToken, { prefer: PREFER_UTC }), 'Microsoft calendar view');
          const data = (await response.json()) as { value?: GraphEvent[]; '@odata.nextLink'?: string };
          for (const event of data.value ?? []) {
            if (event.isCancelled || event.showAs === 'free' || !event.start || !event.end) continue;
            intervals.push({ start: graphUtc(event.start.dateTime), end: graphUtc(event.end.dateTime) });
          }
          next = data['@odata.nextLink'] ?? null;
        }
      }
      return intervals;
    },

    async createEvent(calendarId, event) {
      const response = await expectOk(
        await providerFetch(url(`/me/calendars/${encodeURIComponent(calendarId)}/events`), accessToken, { method: 'POST', body: JSON.stringify(body(event, true)), prefer: PREFER_UTC }),
        'Microsoft event create',
      );
      return result((await response.json()) as GraphEvent);
    },

    async updateEvent(_calendarId, eventId, event) {
      const response = await expectOk(
        await providerFetch(url(`/me/events/${encodeURIComponent(eventId)}`), accessToken, { method: 'PATCH', body: JSON.stringify(body(event, false)), prefer: PREFER_UTC }),
        'Microsoft event update',
      );
      return result((await response.json()) as GraphEvent);
    },

    async deleteEvent(_calendarId, eventId) {
      const response = await providerFetch(url(`/me/events/${encodeURIComponent(eventId)}`), accessToken, { method: 'DELETE' });
      if (response.status === 404) return;
      await expectOk(response, 'Microsoft event delete');
    },

    async getEvent(_calendarId, eventId) {
      const response = await providerFetch(url(`/me/events/${encodeURIComponent(eventId)}?$select=start,end,isCancelled,lastModifiedDateTime`), accessToken, { prefer: PREFER_UTC });
      if (response.status === 404) return { exists: false, cancelled: true, start: null, end: null, version: null };
      const event = (await (await expectOk(response, 'Microsoft event read')).json()) as GraphEvent;
      return {
        exists: true,
        cancelled: Boolean(event.isCancelled),
        start: event.start ? graphUtc(event.start.dateTime) : null,
        end: event.end ? graphUtc(event.end.dateTime) : null,
        version: event.lastModifiedDateTime ?? null,
      };
    },
  };
};
