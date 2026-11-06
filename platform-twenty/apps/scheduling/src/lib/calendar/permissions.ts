import { type Provider } from 'src/constants/enums';

export type CalendarPermissions = {
  listCalendars: boolean;
  readBusy: boolean;
  writeEvents: boolean;
  // Wording of the provider's own consent screen, so users recognise what to allow.
  missing: string[];
};

const GOOGLE = {
  listCalendars: ['calendar.calendarlist.readonly', 'calendar.calendarlist', 'calendar.readonly', 'calendar'],
  readBusy: ['calendar.freebusy', 'calendar.events.freebusy', 'calendar.readonly', 'calendar'],
  writeEvents: ['calendar.events.owned', 'calendar.events', 'calendar'],
};

const GOOGLE_LABELS = {
  listCalendars: "See the list of Google calendars you're subscribed to",
  readBusy: 'View your availability in your calendars',
  writeEvents: 'See, create, change, and delete events on Google calendars you own',
};

const MICROSOFT_CALENDAR_SCOPES = ['calendars.readwrite', 'calendars.readwrite.shared'];

// Google returns full scope URLs and Microsoft returns short Graph names; both are compared by their last segment.
const scopeName = (scope: string) => scope.slice(scope.lastIndexOf('/') + 1).toLowerCase();

// Users can untick permissions on the consent screen. Features whose permission was not granted are switched off and
// never called. An empty list means the provider did not report scopes, so the requested ones are assumed.
export const grantedPermissions = (provider: Provider, scopes: string[] | null | undefined): CalendarPermissions => {
  const granted = new Set((scopes ?? []).map(scopeName));
  if (granted.size === 0) return { listCalendars: true, readBusy: true, writeEvents: true, missing: [] };

  if (provider === 'MICROSOFT') {
    const calendars = MICROSOFT_CALENDAR_SCOPES.some((scope) => granted.has(scope));
    return { listCalendars: calendars, readBusy: calendars, writeEvents: calendars, missing: calendars ? [] : ['Have full access to your calendars'] };
  }

  const has = (accepted: string[]) => accepted.some((scope) => granted.has(scopeName(scope)));
  const permissions = { listCalendars: has(GOOGLE.listCalendars), readBusy: has(GOOGLE.readBusy), writeEvents: has(GOOGLE.writeEvents) };
  return {
    ...permissions,
    missing: (Object.keys(permissions) as (keyof typeof permissions)[]).filter((key) => !permissions[key]).map((key) => GOOGLE_LABELS[key]),
  };
};

// Busy time and writing bookings are what the app is for; without either, the account is paused until reconnected.
export const isUsable = (permissions: CalendarPermissions) => permissions.readBusy && permissions.writeEvents;

export const missingPermissionMessage = (provider: Provider, permissions: CalendarPermissions) =>
  `${provider === 'GOOGLE' ? 'Google' : 'Microsoft'} did not grant: ${permissions.missing.join('; ')}. Reconnect the account and allow these to use it for scheduling.`;
