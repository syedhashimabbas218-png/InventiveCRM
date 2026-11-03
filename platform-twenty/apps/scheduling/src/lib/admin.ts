import { randomUUID } from 'node:crypto';

import { listConnections } from 'twenty-sdk/logic-function';

import { ASSIGNMENTS, CONFERENCING, LOCATION_MODES, MEETING_FORMATS } from 'src/constants/enums';
import { type TimeWindow, type WeeklyRules } from 'src/engine/availability';
import { DAY, isValidTimeZone, WEEKDAYS } from 'src/engine/time';
import { gql, metadata, nodes } from 'src/lib/api';
import { bookAppointment } from 'src/lib/booking';
import { loadAdvisorCalendars, updateSetting } from 'src/lib/calendar/connections';
import { GOOGLE_PROVIDER_NAME, MICROSOFT_PROVIDER_NAME } from 'src/lib/calendar/provider-names';
import { publicBaseUrl } from 'src/lib/notify';
import { mapTicket } from 'src/lib/tokens';
import { ADVISOR_FIELDS, type AdvisorRecord, loadSettings, loadType } from 'src/lib/records';

export class AdminError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Member = { id: string; name: { firstName: string; lastName: string }; userEmail: string; timeZone: string | null };

// Runs with the signed-in user's token, so Twenty's own permissions decide what each user can read and change.
const currentMember = async (): Promise<Member> => {
  const { currentUser } = await metadata<{ currentUser: { workspaceMember: Member | null } }>(`{ currentUser { workspaceMember { id name { firstName lastName } userEmail timeZone } } }`);
  if (!currentUser.workspaceMember) throw new AdminError(403, 'No workspace member for this user.');
  return currentUser.workspaceMember;
};

const myAdvisor = async (memberId: string) => {
  const data = await gql<{ advisors: { edges: { node: AdvisorRecord }[] } }>(
    `query($id: String!) { advisors(filter: { workspaceMemberId: { eq: $id } }, first: 1) { edges { node { ${ADVISOR_FIELDS} } } } }`,
    { id: memberId },
  );
  return nodes(data.advisors)[0] ?? null;
};

type Row = {
  id: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt: string;
  customerName: string;
  meetingFormat: string;
  location: string;
  calendarStatus: string;
  advisor: { id: string; name: string } | null;
  appointmentType: { name: string; color: string } | null;
};

const ROW = 'id title status startsAt endsAt customerName meetingFormat location calendarStatus advisor { id name } appointmentType { name color }';

const embedSnippets = (base: string, slug: string) => ({
  inline: `<div data-crm-booking="${slug}"></div>\n<script src="${base}/booking/embed.js" async></script>`,
  popup: `<a href="${base}/book/${slug}" data-crm-booking-popup="${slug}">Book an appointment</a>\n<script src="${base}/booking/embed.js" async></script>`,
  floating: `<script src="${base}/booking/embed.js" data-floating="${slug}" data-label="Book an appointment" async></script>`,
});

const overview = async () => {
  const member = await currentMember();
  const advisor = await myAdvisor(member.id);
  const now = Date.now();
  const base = await publicBaseUrl();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const data = await gql<{
    upcoming: { edges: { node: Row }[] };
    recent: { edges: { node: { name: string; occurredAt: string; actor: string; details: { from?: string } | null; appointment: { title: string; customerName: string; startsAt: string } | null } }[] };
    types: { edges: { node: { id: string; name: string; slug: string; status: string; durationMinutes: number; assignment: string; meetingFormat: string; locationMode: string; ownerId: string | null; team: { name: string } | null } }[] };
    links: { edges: { node: { name: string; slug: string; isActive: boolean; appointmentType: { name: string } | null } }[] };
    failing: { totalCount: number };
  }>(
    `query($from: DateTime!, $to: DateTime!) {
      upcoming: appointments(filter: { and: [{ startsAt: { gte: $from } }, { startsAt: { lt: $to } }], status: { neq: CANCELLED } }, orderBy: [{ startsAt: AscNullsLast }], first: 200) { edges { node { ${ROW} } } }
      recent: schedulingAuditEvents(filter: { name: { in: ["appointment.created", "appointment.cancelled", "appointment.rescheduled", "advisor.assigned"] } }, orderBy: [{ occurredAt: DescNullsLast }], first: 30) {
        edges { node { name occurredAt actor details appointment { title customerName startsAt } } }
      }
      types: appointmentTypes(orderBy: [{ name: AscNullsLast }], first: 100) { edges { node { id name slug status durationMinutes assignment meetingFormat locationMode ownerId team { name } } } }
      links: bookingLinks(first: 100) { edges { node { name slug isActive appointmentType { name } } } }
      failing: calendarSyncs(filter: { status: { eq: GAVE_UP } }) { totalCount }
    }`,
    { from: startOfDay.toISOString(), to: new Date(now + 14 * DAY).toISOString() },
  );
  const upcoming = nodes(data.upcoming);
  const connections = advisor ? await connectionSummaries(advisor) : [];
  return {
    member: { name: `${member.name.firstName} ${member.name.lastName}`.trim(), email: member.userEmail },
    advisor: advisor ? { id: advisor.id, name: advisor.name, bookingSlug: advisor.bookingSlug, personalUrl: advisor.bookingSlug ? `${base}/book/${advisor.bookingSlug}` : null } : null,
    today: upcoming.filter((row) => Date.parse(row.startsAt) < startOfDay.getTime() + DAY),
    mine: advisor ? upcoming.filter((row) => row.advisor?.id === advisor.id) : [],
    team: upcoming,
    // Assignment at booking time is part of "booked"; only later reassignments are shown separately.
    recent: nodes(data.recent).filter((event) => event.name !== 'advisor.assigned' || Boolean(event.details?.from)),
    connections,
    failingSyncs: data.failing.totalCount,
    bookingPages: [
      ...nodes(data.types).map((type) => ({
        kind: 'type',
        name: type.name,
        status: type.status,
        detail: `${type.durationMinutes} min · ${type.assignment.replace(/_/g, ' ').toLowerCase()}${type.team ? ` · ${type.team.name}` : ''}`,
        url: `${base}/book/${type.slug}`,
        embed: embedSnippets(base, type.slug),
        mine: type.ownerId === advisor?.id,
      })),
      ...nodes(data.links).map((link) => ({
        kind: 'link',
        name: link.name,
        status: link.isActive ? 'ACTIVE' : 'DISABLED',
        detail: link.appointmentType?.name ?? '',
        url: `${base}/book/${link.slug}`,
        embed: embedSnippets(base, link.slug),
        mine: false,
      })),
    ],
  };
};

const connectionSummaries = async (advisor: AdvisorRecord) =>
  (await loadAdvisorCalendars(advisor)).map(({ setting }) => ({
    id: setting.id,
    name: setting.name,
    provider: setting.provider,
    status: setting.status,
    bookingCalendarId: setting.bookingCalendarId,
    availabilityCalendarIds: setting.availabilityCalendarIds ?? [],
    conferencing: setting.conferencing,
  }));

// Only the signed-in user's own accounts are listed, even though the app can see everyone's.
const connections = async () => {
  const member = await currentMember();
  const advisor = await myAdvisor(member.id);
  if (!advisor) return { advisor: null, applicationId: process.env.APPLICATION_ID ?? null, connections: [] };
  const own = (await Promise.all([GOOGLE_PROVIDER_NAME, MICROSOFT_PROVIDER_NAME].map((providerName) => listConnections({ providerName, scope: 'USER' })))).flat().filter((connection) => connection.workspaceMemberId === member.id);
  const calendars = await loadAdvisorCalendars(advisor);
  return {
    advisor: { id: advisor.id, name: advisor.name },
    applicationId: process.env.APPLICATION_ID ?? null,
    connections: await Promise.all(
      calendars.map(async ({ setting, provider, adapter }) => {
        const connection = own.find((candidate) => candidate.id === setting.connectionId);
        let available: { id: string; name: string; primary: boolean; canWrite: boolean }[] = [];
        let error = '';
        let status = setting.status;
        if (adapter) {
          try {
            available = await adapter.listCalendars();
            // Opening this page re-checks the account, so a reconnect shows as connected straight away.
            if (status !== 'CONNECTED') {
              status = 'CONNECTED';
              await updateSetting(setting.id, { status, lastError: '', lastCheckedAt: new Date().toISOString() });
            }
          } catch (listError) {
            error = (listError as Error).message;
          }
        }
        return { ...setting, status, provider, calendars: available, error, authFailed: Boolean(connection?.authFailedAt) };
      }),
    ),
  };
};

const saveConnection = async (body: Record<string, unknown>) => {
  const member = await currentMember();
  const advisor = await myAdvisor(member.id);
  const settingId = String(body.settingId ?? '');
  const calendars = advisor ? await loadAdvisorCalendars(advisor) : [];
  const target = calendars.find((calendar) => calendar.setting.id === settingId);
  if (!target) throw new AdminError(404, 'That connection is not yours.');
  const ids = Array.isArray(body.availabilityCalendarIds) ? body.availabilityCalendarIds.map(String).slice(0, 50) : target.setting.availabilityCalendarIds ?? [];
  const bookingCalendarId = typeof body.bookingCalendarId === 'string' ? body.bookingCalendarId : target.setting.bookingCalendarId;
  if (target.adapter) {
    const known = (await target.adapter.listCalendars()).map((calendar) => calendar.id);
    if ([...ids, bookingCalendarId].some((id) => !known.includes(id))) throw new AdminError(400, 'Unknown calendar for this account.');
  }
  const conferencing = ['NONE', 'GOOGLE_MEET', 'MICROSOFT_TEAMS', 'FIXED_LINK'].includes(String(body.conferencing)) ? String(body.conferencing) : target.setting.conferencing;
  await updateSetting(settingId, { availabilityCalendarIds: ids, bookingCalendarId, conferencing });
  return { saved: true };
};

const DEFAULT_WEEK = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map((day) => [day, [{ start: '09:00', end: '17:00' }]]));

const setupAdvisor = async () => {
  const member = await currentMember();
  const existing = await myAdvisor(member.id);
  if (existing) return { advisorId: existing.id, created: false };
  const settings = await loadSettings();
  const name = `${member.name.firstName} ${member.name.lastName}`.trim() || member.userEmail;
  const timeZone = member.timeZone && member.timeZone !== 'system' ? member.timeZone : settings.defaultTimeZone;
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${randomUUID().slice(0, 4)}`;
  const { createAdvisor } = await gql<{ createAdvisor: { id: string } }>(`mutation($data: AdvisorCreateInput!) { createAdvisor(data: $data) { id } }`, {
    data: { name, workspaceMemberId: member.id, email: member.userEmail, timeZone, bookingSlug: slug, isActive: true },
  });
  const { createAvailabilitySchedule } = await gql<{ createAvailabilitySchedule: { id: string } }>(
    `mutation($data: AvailabilityScheduleCreateInput!) { createAvailabilitySchedule(data: $data) { id } }`,
    { data: { name: `${name}: working hours`, timeZone, weeklyHours: DEFAULT_WEEK, isDefault: true, ownerId: createAdvisor.id } },
  );
  await gql(`mutation($id: UUID!, $data: AdvisorUpdateInput!) { updateAdvisor(id: $id, data: $data) { id } }`, { id: createAdvisor.id, data: { scheduleId: createAvailabilitySchedule.id } });
  return { advisorId: createAdvisor.id, created: true };
};

// Booking from inside the CRM goes through the same checks and reservation as a customer booking.
const manualBook = async (body: Record<string, unknown>) => {
  const type = await loadType(String(body.appointmentTypeId ?? ''));
  if (!type) throw new AdminError(404, 'Appointment type not found.');
  const customer = (body.customer ?? {}) as { name?: string; email?: string; phone?: string };
  const result = await bookAppointment({
    type: { ...type, status: 'ACTIVE', minimumNoticeMinutes: 0 },
    link: null,
    start: Date.parse(String(body.start ?? '')),
    advisorId: typeof body.advisorId === 'string' ? body.advisorId : null,
    customer: { name: String(customer.name ?? ''), email: String(customer.email ?? ''), phone: customer.phone ? String(customer.phone) : null, timeZone: type.timeZone || 'Europe/London' },
    answers: {},
    location: null,
    idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : randomUUID(),
    source: 'MANUAL',
  });
  return { appointmentId: result.appointmentId, advisorName: result.advisorName, start: new Date(result.start).toISOString() };
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

const cleanWindows = (value: unknown): TimeWindow[] =>
  (Array.isArray(value) ? value : [])
    .slice(0, 8)
    .map((window) => ({ start: String((window as TimeWindow).start ?? ''), end: String((window as TimeWindow).end ?? '') }))
    .filter((window) => {
      if (!TIME.test(window.start) || !TIME.test(window.end) || window.start === window.end) throw new AdminError(400, `Invalid hours ${window.start} to ${window.end}.`);
      return true;
    });

type ScheduleRow = { id: string; name: string; timeZone: string; weeklyHours: WeeklyRules | null; isDefault: boolean; overrides: { edges: { node: { id: string; name: string; startDate: string; endDate: string; kind: string; windows: TimeWindow[] | null } }[] } };

const mySchedule = async () => {
  const member = await currentMember();
  const advisor = await myAdvisor(member.id);
  if (!advisor) throw new AdminError(404, 'Create your advisor profile first.');
  const scheduleId = advisor.schedule?.id ?? nodes(advisor.schedules)[0]?.id;
  if (!scheduleId) throw new AdminError(404, 'You have no availability schedule.');
  const data = await gql<{ availabilitySchedules: { edges: { node: ScheduleRow }[] } }>(
    `query($id: UUID!) { availabilitySchedules(filter: { id: { eq: $id } }) { edges { node { id name timeZone weeklyHours isDefault overrides(first: 200, orderBy: [{ startDate: AscNullsLast }]) { edges { node { id name startDate endDate kind windows } } } } } } }`,
    { id: scheduleId },
  );
  return { advisor, schedule: nodes(data.availabilitySchedules)[0] };
};

const availability = async () => {
  const { advisor, schedule } = await mySchedule();
  return {
    advisor: { id: advisor.id, name: advisor.name, dailyLimit: advisor.dailyLimit, weeklyLimit: advisor.weeklyLimit },
    schedule: { id: schedule.id, name: schedule.name, timeZone: schedule.timeZone || advisor.timeZone, weeklyHours: schedule.weeklyHours ?? {} },
    overrides: nodes(schedule.overrides).filter((override) => override.endDate >= new Date().toISOString().slice(0, 10)),
  };
};

const saveAvailability = async (body: Record<string, unknown>) => {
  const { advisor, schedule } = await mySchedule();
  const timeZone = String(body.timeZone ?? schedule.timeZone);
  if (!isValidTimeZone(timeZone)) throw new AdminError(400, `Unknown time zone ${timeZone}.`);
  const hours = (body.weeklyHours ?? {}) as Record<string, unknown>;
  const weeklyHours = Object.fromEntries(WEEKDAYS.map((day) => [day, cleanWindows(hours[day])]).filter(([, windows]) => (windows as TimeWindow[]).length > 0));
  await gql(`mutation($id: UUID!, $data: AvailabilityScheduleUpdateInput!) { updateAvailabilitySchedule(id: $id, data: $data) { id } }`, { id: schedule.id, data: { timeZone, weeklyHours } });
  const limit = (value: unknown) => (value === null || value === '' || value === undefined ? null : Math.max(0, Math.floor(Number(value))) || null);
  await gql(`mutation($id: UUID!, $data: AdvisorUpdateInput!) { updateAdvisor(id: $id, data: $data) { id } }`, { id: advisor.id, data: { timeZone, dailyLimit: limit(body.dailyLimit), weeklyLimit: limit(body.weeklyLimit) } });
  return { saved: true };
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const addOverride = async (body: Record<string, unknown>) => {
  const { schedule } = await mySchedule();
  const startDate = String(body.startDate ?? '');
  const endDate = String(body.endDate || startDate);
  if (!DATE.test(startDate) || !DATE.test(endDate) || endDate < startDate) throw new AdminError(400, 'Choose valid dates.');
  const kind = body.kind === 'CUSTOM_HOURS' ? 'CUSTOM_HOURS' : 'UNAVAILABLE';
  const windows = cleanWindows(body.windows);
  if (kind === 'CUSTOM_HOURS' && windows.length === 0) throw new AdminError(400, 'Special hours need at least one time window.');
  await gql(`mutation($data: AvailabilityOverrideCreateInput!) { createAvailabilityOverride(data: $data) { id } }`, {
    data: { name: String(body.name || (kind === 'UNAVAILABLE' ? 'Time off' : 'Special hours')).slice(0, 120), startDate, endDate, kind, windows, scheduleId: schedule.id },
  });
  return { saved: true };
};

const removeOverride = async (body: Record<string, unknown>) => {
  const { schedule } = await mySchedule();
  const id = String(body.id ?? '');
  if (!nodes(schedule.overrides).some((override) => override.id === id)) throw new AdminError(404, 'That entry is not on your schedule.');
  await gql(`mutation($id: UUID!) { deleteAvailabilityOverride(id: $id) { id } }`, { id });
  return { removed: true };
};

const pick = (options: Record<string, unknown>, value: unknown, fallback: string) => (typeof value === 'string' && value in options ? value : fallback);

const quickType = async (body: Record<string, unknown>) => {
  const member = await currentMember();
  const advisor = await myAdvisor(member.id);
  const name = String(body.name ?? '').trim().slice(0, 120);
  if (!name) throw new AdminError(400, 'Give the appointment type a name.');
  const settings = await loadSettings();
  if (settings.maxAppointmentTypes) {
    const { appointmentTypes } = await gql<{ appointmentTypes: { totalCount: number } }>(`{ appointmentTypes { totalCount } }`);
    if (appointmentTypes.totalCount >= settings.maxAppointmentTypes) throw new AdminError(400, `This workspace allows ${settings.maxAppointmentTypes} appointment types.`);
  }
  const teamId = typeof body.teamId === 'string' && body.teamId ? body.teamId : null;
  const format = pick(MEETING_FORMATS, body.meetingFormat, 'VIRTUAL');
  const duration = Math.min(480, Math.max(5, Math.round(Number(body.durationMinutes) / 5) * 5 || 30));
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${randomUUID().slice(0, 4)}`;
  const { createAppointmentType } = await gql<{ createAppointmentType: { id: string } }>(`mutation($data: AppointmentTypeCreateInput!) { createAppointmentType(data: $data) { id } }`, {
    data: {
      name,
      slug,
      status: 'DRAFT',
      durationMinutes: duration,
      incrementMinutes: Math.min(duration, 30),
      meetingFormat: format,
      conferencing: format === 'VIRTUAL' ? pick(CONFERENCING, body.conferencing, 'NONE') : 'NONE',
      assignment: teamId ? pick(ASSIGNMENTS, body.assignment, 'ROUND_ROBIN') : 'ONE_TO_ONE',
      roundRobinStrategy: 'EQUAL',
      locationMode: format === 'AT_CUSTOMER' ? pick(LOCATION_MODES, body.locationMode, 'NEAREST') : 'NONE',
      ownerId: teamId ? null : (advisor?.id ?? null),
      teamId,
      timeZone: advisor?.timeZone || settings.defaultTimeZone,
    },
  });
  return { id: createAppointmentType.id, slug };
};

export const handleAdmin = async (body: Record<string, unknown>) => {
  switch (String(body.action ?? '')) {
    case 'overview':
      return overview();
    case 'connections':
      return connections();
    case 'saveConnection':
      return saveConnection(body);
    case 'setupAdvisor':
      return setupAdvisor();
    case 'manualBook':
      return manualBook(body);
    case 'availability':
      return availability();
    case 'saveAvailability':
      return saveAvailability(body);
    case 'addOverride':
      return addOverride(body);
    case 'removeOverride':
      return removeOverride(body);
    case 'quickType':
      return quickType(body);
    case 'bookableTypes': {
      const { appointmentTypes } = await gql<{ appointmentTypes: { edges: { node: { id: string; name: string } }[] } }>(
        `{ appointmentTypes(filter: { status: { neq: DISABLED } }, orderBy: [{ name: AscNullsLast }], first: 100) { edges { node { id name } } } }`,
      );
      return { types: nodes(appointmentTypes) };
    }
    case 'teams': {
      const { schedulingTeams } = await gql<{ schedulingTeams: { edges: { node: { id: string; name: string } }[] } }>(`{ schedulingTeams(filter: { isActive: { eq: true } }, first: 100) { edges { node { id name } } } }`);
      return { teams: nodes(schedulingTeams) };
    }
    case 'mapLink': {
      const member = await currentMember();
      // The map page reads with the app's access, so check the person's own access before handing out a ticket.
      await gql(`{ advisors(first: 1) { totalCount } offices(first: 1) { totalCount } }`).catch(() => {
        throw new AdminError(403, 'Your role cannot see advisors and offices.');
      });
      return { url: `${await publicBaseUrl()}/scheduling/map?ticket=${encodeURIComponent(mapTicket(member.id))}` };
    }
    case 'testConnection': {
      const member = await currentMember();
      const advisor = await myAdvisor(member.id);
      const calendar = advisor ? (await loadAdvisorCalendars(advisor)).find((item) => item.setting.id === body.settingId) : null;
      if (!calendar) throw new AdminError(404, 'That connection is not yours.');
      if (!calendar.adapter) return { ok: false, message: 'The account needs reconnecting.' };
      const busy = await calendar.adapter.busy(calendar.setting.availabilityCalendarIds ?? [], Date.now(), Date.now() + 7 * DAY);
      return { ok: true, message: `Connected: ${busy.length} busy periods in the next 7 days.` };
    }
    default:
      throw new AdminError(400, 'Unknown action.');
  }
};
