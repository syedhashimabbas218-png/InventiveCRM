import { listConnections, reportConnectionAuthFailure } from 'twenty-sdk/logic-function';

import { type Provider } from 'src/constants/enums';
import { type Interval } from 'src/engine/availability';
import { cachedForRun, gql, nodes } from 'src/lib/api';
import { allPages, PAGE_INFO, type Page } from 'src/lib/pagination';
import { verifyAdvisorMemberSeal } from 'src/lib/tokens';
import { googleCalendar } from 'src/lib/calendar/google';
import { microsoftCalendar } from 'src/lib/calendar/microsoft';
import { GOOGLE_PROVIDER_NAME, MICROSOFT_PROVIDER_NAME } from 'src/lib/calendar/provider-names';
import { type CalendarPermissions, grantedPermissions, isUsable, missingPermissionMessage } from 'src/lib/calendar/permissions';
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
  lastCheckedAt?: string | null;
};

export type AdvisorCalendar = { setting: CalendarSettingRecord; provider: Provider; adapter: CalendarAdapter | null; permissions: CalendarPermissions };

const SETTING_FIELDS = 'id name connectionId provider accountEmail availabilityCalendarIds bookingCalendarId conferencing status advisorId lastCheckedAt';

const FORGET_AFTER_MS = 7 * 86_400_000;

const PROVIDER_BY_NAME: Record<string, Provider> = { [GOOGLE_PROVIDER_NAME]: 'GOOGLE', [MICROSOFT_PROVIDER_NAME]: 'MICROSOFT' };

// One list per run instead of one per advisor: Twenty counts an app's API calls across all workspaces against one limit.
const allCalendarConnections = cachedForRun(() =>
  Promise.all([GOOGLE_PROVIDER_NAME, MICROSOFT_PROVIDER_NAME].map((providerName) => listConnections({ providerName, scope: 'USER' }))).then((lists) => lists.flat()),
);

// Without the calendar-list permission only the primary calendar is offered, and the list is never requested.
export const adapterFor = (provider: Provider, accessToken: string, permissions?: CalendarPermissions): CalendarAdapter => {
  const adapter = provider === 'GOOGLE' ? googleCalendar(accessToken) : microsoftCalendar(accessToken);
  if (!permissions || permissions.listCalendars || provider !== 'GOOGLE') return adapter;
  return { ...adapter, listCalendars: async () => [{ id: 'primary', name: 'Primary calendar', primary: true, canWrite: true }] };
};

export const updateSetting = (id: string, data: Record<string, unknown>) =>
  gql(`mutation($id: UUID!, $data: CalendarSettingUpdateInput!) { updateCalendarSetting(id: $id, data: $data) { id } }`, { id, data });

// The app reads connections with its own token, so this sees every advisor's accounts; callers that serve a signed-in
// user must only show that user's own.
type AdvisorRef = { id: string; workspaceMemberId: string | null; memberSeal?: string | null };

// workspaceMemberId is an ordinary editable field, so a member's calendar accounts are only used by an advisor the
// member created or confirmed themselves (the seal). Pointing someone else's advisor at you gives it nothing.
export const linkedMember = async (advisor: AdvisorRef) => {
  if (!advisor.workspaceMemberId) return null;
  const seal =
    advisor.memberSeal !== undefined
      ? advisor.memberSeal
      : nodes((await gql<{ advisors: { edges: { node: { memberSeal: string | null } }[] } }>(`query($id: UUID!) { advisors(filter: { id: { eq: $id } }) { edges { node { memberSeal } } } }`, { id: advisor.id })).advisors)[0]?.memberSeal;
  return verifyAdvisorMemberSeal(advisor.id, advisor.workspaceMemberId, seal) ? advisor.workspaceMemberId : null;
};

// One query for a whole slot search instead of one per advisor.
export const calendarSettingsByAdvisor = async (advisorIds: string[]) => {
  const byAdvisor = new Map<string, CalendarSettingRecord[]>();
  if (advisorIds.length === 0) return byAdvisor;
  const settings = await allPages((after) =>
    gql<{ calendarSettings: Page<CalendarSettingRecord> }>(
      `query($ids: [UUID!], $after: String) { calendarSettings(filter: { advisorId: { in: $ids } }, first: 500, after: $after) { edges { node { ${SETTING_FIELDS} } } ${PAGE_INFO} } }`,
      { ids: advisorIds, after },
    ).then((data) => data.calendarSettings),
  );
  for (const setting of settings) if (setting.advisorId) byAdvisor.set(setting.advisorId, [...(byAdvisor.get(setting.advisorId) ?? []), setting]);
  return byAdvisor;
};

export const loadAdvisorCalendars = async (advisor: AdvisorRef, preloadedSettings?: CalendarSettingRecord[]): Promise<AdvisorCalendar[]> => {
  const memberId = await linkedMember(advisor);
  const [connections, settings] = await Promise.all([
    memberId ? allCalendarConnections().then((list) => list.filter((connection) => connection.workspaceMemberId === memberId)) : Promise.resolve([]),
    preloadedSettings ??
      gql<{ calendarSettings: { edges: { node: CalendarSettingRecord }[] } }>(
        `query($advisorId: UUID!) { calendarSettings(filter: { advisorId: { eq: $advisorId } }) { edges { node { ${SETTING_FIELDS} } } } }`,
        { advisorId: advisor.id },
      ).then((data) => nodes(data.calendarSettings)),
  ]);
  const calendars: AdvisorCalendar[] = [];

  for (const connection of connections) {
    const provider = PROVIDER_BY_NAME[connection.providerName];
    if (!provider) continue;
    let setting = settings.find((candidate) => candidate.connectionId === connection.id);
    const permissions = grantedPermissions(provider, connection.scopes);
    const usable = isUsable(permissions);
    const adapter = connection.authFailedAt || !connection.accessToken || !usable ? null : adapterFor(provider, connection.accessToken, permissions);
    if (!setting) setting = await createDefaultSetting(advisor.id, connection.id, provider, connection.handle ?? connection.name ?? '', adapter);
    // A refusal seen by this app stays flagged until a provider call succeeds again, even while Twenty still holds a token.
    const status = !adapter ? 'NEEDS_RECONNECT' : setting.status === 'DISCONNECTED' ? 'CONNECTED' : setting.status;
    if (status !== setting.status) {
      const reason = !usable ? missingPermissionMessage(provider, permissions) : (connection.authFailedReason ?? 'Sign-in expired: reconnect the account.');
      await updateSetting(setting.id, { status, lastError: adapter ? '' : reason });
      setting = { ...setting, status };
    }
    calendars.push({ setting, provider, adapter, permissions });
  }

  // Twenty also leaves a connection out of its list while a token refresh fails, so a missing account is first only
  // marked disconnected. After a week away it is treated as gone: the address and calendar ids the app kept are
  // removed, and the row stays so history and sync rows still point somewhere.
  const now = Date.now();
  for (const orphan of settings.filter((setting) => !connections.some((connection) => connection.id === setting.connectionId))) {
    if (orphan.status !== 'DISCONNECTED') await updateSetting(orphan.id, { status: 'DISCONNECTED', lastError: 'The account is not connected.', lastCheckedAt: new Date(now).toISOString() });
    else if (orphan.accountEmail && orphan.lastCheckedAt && now - Date.parse(orphan.lastCheckedAt) > FORGET_AFTER_MS)
      await updateSetting(orphan.id, {
        lastError: 'The account was disconnected.',
        name: `${orphan.provider === 'GOOGLE' ? 'Google' : 'Microsoft'}: disconnected account`,
        accountEmail: '',
        availabilityCalendarIds: [],
        bookingCalendarId: '',
      });
  }
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
