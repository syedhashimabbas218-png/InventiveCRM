import { listConnections, reportConnectionAuthFailure } from 'twenty-sdk/logic-function';

import { type Provider } from 'src/constants/enums';
import { type Interval } from 'src/engine/availability';
import { cachedForRun, gql, nodes } from 'src/lib/api';
import { googleCalendar } from 'src/lib/calendar/google';
import { microsoftCalendar } from 'src/lib/calendar/microsoft';
import { GOOGLE_PROVIDER_NAME, MICROSOFT_PROVIDER_NAME } from 'src/lib/calendar/provider-names';
import { type CalendarAdapter, CalendarAuthError } from 'src/lib/calendar/types';

export type CalendarSettingRecord = {
  id: string;
  name: string;
  connectionId: string;
  provider: Provider;
  accountEmail: string;
  availabilityCalendarIds: string[] | null;
  bookingCalendarId: string;
  conferencing: string;
  status: string;
  advisorId: string | null;
};

export type AdvisorCalendar = { setting: CalendarSettingRecord; provider: Provider; adapter: CalendarAdapter | null };

const SETTING_FIELDS = 'id name connectionId provider accountEmail availabilityCalendarIds bookingCalendarId conferencing status advisorId';

const PROVIDER_BY_NAME: Record<string, Provider> = { [GOOGLE_PROVIDER_NAME]: 'GOOGLE', [MICROSOFT_PROVIDER_NAME]: 'MICROSOFT' };

// One list per run instead of one per advisor: Twenty counts an app's API calls across all workspaces against one limit.
const allCalendarConnections = cachedForRun(() =>
  Promise.all([GOOGLE_PROVIDER_NAME, MICROSOFT_PROVIDER_NAME].map((providerName) => listConnections({ providerName, scope: 'USER' }))).then((lists) => lists.flat()),
);

export const adapterFor = (provider: Provider, accessToken: string) =>
  provider === 'GOOGLE' ? googleCalendar(accessToken) : microsoftCalendar(accessToken);

export const updateSetting = (id: string, data: Record<string, unknown>) =>
  gql(`mutation($id: UUID!, $data: CalendarSettingUpdateInput!) { updateCalendarSetting(id: $id, data: $data) { id } }`, { id, data });

// The app reads connections with its own token, so this sees every advisor's accounts; callers that serve a signed-in
// user must only show that user's own.
export const loadAdvisorCalendars = async (advisor: { id: string; workspaceMemberId: string | null }): Promise<AdvisorCalendar[]> => {
  const [connections, settingsData] = await Promise.all([
    advisor.workspaceMemberId
      ? allCalendarConnections().then((list) => list.filter((connection) => connection.workspaceMemberId === advisor.workspaceMemberId))
      : Promise.resolve([]),
    gql<{ calendarSettings: { edges: { node: CalendarSettingRecord }[] } }>(
      `query($advisorId: UUID!) { calendarSettings(filter: { advisorId: { eq: $advisorId } }) { edges { node { ${SETTING_FIELDS} } } } }`,
      { advisorId: advisor.id },
    ),
  ]);
  const settings = nodes(settingsData.calendarSettings);
  const calendars: AdvisorCalendar[] = [];

  for (const connection of connections) {
    const provider = PROVIDER_BY_NAME[connection.providerName];
    let setting = settings.find((candidate) => candidate.connectionId === connection.id);
    const adapter = connection.authFailedAt || !connection.accessToken ? null : adapterFor(provider, connection.accessToken);
    if (!setting) setting = await createDefaultSetting(advisor.id, connection.id, provider, connection.handle ?? connection.name ?? '', adapter);
    // A refusal seen by this app stays flagged until a provider call succeeds again, even while Twenty still holds a token.
    const status = !adapter ? 'NEEDS_RECONNECT' : setting.status === 'DISCONNECTED' ? 'CONNECTED' : setting.status;
    if (status !== setting.status) {
      await updateSetting(setting.id, { status, ...(adapter ? { lastError: '' } : { lastError: connection.authFailedReason ?? 'Sign-in expired: reconnect the account.' }) });
      setting = { ...setting, status };
    }
    calendars.push({ setting, provider, adapter });
  }

  for (const orphan of settings.filter((setting) => !connections.some((connection) => connection.id === setting.connectionId)))
    if (orphan.status !== 'DISCONNECTED') await updateSetting(orphan.id, { status: 'DISCONNECTED', lastError: 'The account was disconnected.' });
  return calendars;
};

// New connections block time on, and receive bookings in, the account's primary calendar until the user changes it.
const createDefaultSetting = async (advisorId: string, connectionId: string, provider: Provider, handle: string, adapter: CalendarAdapter | null) => {
  let primary = provider === 'GOOGLE' ? 'primary' : '';
  if (adapter) {
    try {
      primary = (await adapter.listCalendars()).find((calendar) => calendar.primary)?.id ?? primary;
    } catch {
      // Keep the default; the connection status is set when the calendar is next used.
    }
  }
  const data = {
    name: `${provider === 'GOOGLE' ? 'Google' : 'Microsoft'}: ${handle}`,
    connectionId,
    provider,
    accountEmail: handle,
    availabilityCalendarIds: primary ? [primary] : [],
    bookingCalendarId: primary,
    conferencing: provider === 'GOOGLE' ? 'GOOGLE_MEET' : 'MICROSOFT_TEAMS',
    status: adapter ? 'CONNECTED' : 'NEEDS_RECONNECT',
    advisorId,
  };
  const { createCalendarSetting } = await gql<{ createCalendarSetting: CalendarSettingRecord }>(
    `mutation($data: CalendarSettingCreateInput!) { createCalendarSetting(data: $data) { ${SETTING_FIELDS} } }`,
    { data },
  );
  return createCalendarSetting;
};

export type BusyResult = { intervals: Interval[]; failures: string[] };

// Busy time across every calendar the advisor chose. A calendar that cannot answer is reported, and the caller treats
// the advisor as unavailable rather than offering times that might clash.
export const advisorExternalBusy = async (calendars: AdvisorCalendar[], from: number, to: number): Promise<BusyResult> => {
  const intervals: Interval[] = [];
  const failures: string[] = [];
  await Promise.all(
    calendars
      .filter((calendar) => calendar.setting.status !== 'DISCONNECTED')
      .map(async ({ setting, adapter }) => {
        if (!adapter) {
          failures.push(`${setting.name} needs reconnecting`);
          return;
        }
        try {
          intervals.push(...(await adapter.busy(setting.availabilityCalendarIds ?? [], from, to)));
          if (setting.status !== 'CONNECTED') await updateSetting(setting.id, { status: 'CONNECTED', lastError: '', lastCheckedAt: new Date().toISOString() });
        } catch (error) {
          const auth = error instanceof CalendarAuthError;
          failures.push(`${setting.name}: ${(error as Error).message}`);
          await updateSetting(setting.id, { status: auth ? 'NEEDS_RECONNECT' : 'ERROR', lastError: (error as Error).message.slice(0, 500), lastCheckedAt: new Date().toISOString() });
          // Lets Twenty's own account settings show the connection as needing a reconnect.
          if (auth) await reportConnectionAuthFailure({ connectionId: setting.connectionId, reason: (error as Error).message.slice(0, 200) }).catch(() => undefined);
        }
      }),
  );
  return { intervals, failures };
};

export const bookingCalendar = (calendars: AdvisorCalendar[]) =>
  calendars.find((calendar) => calendar.setting.status !== 'DISCONNECTED' && calendar.setting.bookingCalendarId) ?? null;
