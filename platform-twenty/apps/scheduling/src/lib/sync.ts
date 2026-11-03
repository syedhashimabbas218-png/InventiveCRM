import { MINUTE } from 'src/engine/time';
import { gql, nodes } from 'src/lib/api';
import { type AppointmentRecord } from 'src/lib/booking';
import { type AdvisorCalendar, bookingCalendar, loadAdvisorCalendars, updateSetting } from 'src/lib/calendar/connections';
import { type CalendarEventInput, CalendarAuthError, CalendarRequestError } from 'src/lib/calendar/types';
import { formatWhen, sendMail } from 'src/lib/notify';

type SyncRow = {
  id: string;
  name: string;
  provider: string;
  connectionId: string;
  calendarId: string;
  externalEventId: string;
  status: string;
  attempts: number | null;
  externalUpdatedAt: string;
  syncedAt: string | null;
  advisorId: string | null;
  appointmentId: string | null;
};

const SYNC_FIELDS = 'id name provider connectionId calendarId externalEventId status attempts externalUpdatedAt syncedAt advisorId appointmentId';
const BACKOFF_MINUTES = [1, 5, 15, 60, 240, 240, 240, 240];
export const MAX_SYNC_ATTEMPTS = BACKOFF_MINUTES.length;

const syncKey = (appointment: AppointmentRecord, advisorId: string) =>
  appointment.sessionKey ? `session:${appointment.sessionKey}:${advisorId}` : `appointment:${appointment.id}:${advisorId}`;

const sessionMembers = async (sessionKey: string) => {
  const data = await gql<{ appointments: { edges: { node: { customerName: string; customerEmail: string; customerPhone: string } }[] } }>(
    `query($key: String!) { appointments(filter: { sessionKey: { eq: $key }, status: { neq: CANCELLED } }, first: 500) { edges { node { customerName customerEmail customerPhone } } } }`,
    { key: sessionKey },
  );
  return nodes(data.appointments);
};

// Customers are not added as attendees: Microsoft would send its own invitation, and the customer already gets ours.
const eventFor = async (appointment: AppointmentRecord, calendar: AdvisorCalendar): Promise<CalendarEventInput> => {
  const type = appointment.appointmentType;
  const group = appointment.sessionKey ? await sessionMembers(appointment.sessionKey) : null;
  const answers = Object.entries(appointment.intakeAnswers ?? {}).map(([key, value]) => {
    const label = (type?.intakeQuestions ?? []).find((question) => question.id === key)?.label ?? key;
    return `${label}: ${value}`;
  });
  const customers = group ?? [{ customerName: appointment.customerName, customerEmail: appointment.customerEmail, customerPhone: appointment.customerPhone }];
  const conference = type?.conferencing === 'GOOGLE_MEET' && calendar.provider === 'GOOGLE' ? 'GOOGLE_MEET' : type?.conferencing === 'MICROSOFT_TEAMS' && calendar.provider === 'MICROSOFT' ? 'MICROSOFT_TEAMS' : null;
  return {
    idempotencyKey: syncKey(appointment, calendar.setting.advisorId ?? ''),
    title: group ? `${type?.name ?? 'Appointment'} (${group.length} booked)` : `${type?.name ?? 'Appointment'}: ${appointment.customerName}`,
    description: [
      ...customers.map((customer) => `${customer.customerName} <${customer.customerEmail}>${customer.customerPhone ? `, ${customer.customerPhone}` : ''}`),
      ...(group ? [] : answers),
      appointment.location ? `Where: ${appointment.location}` : '',
      'Managed by InventiveCRM Scheduling: change or cancel it there, not in this calendar.',
    ]
      .filter(Boolean)
      .join('\n'),
    start: Date.parse(appointment.startsAt),
    end: Date.parse(appointment.endsAt),
    timeZone: appointment.advisor?.timeZone || appointment.customerTimeZone || 'UTC',
    location: appointment.meetingFormat === 'VIRTUAL' ? null : appointment.location || null,
    attendees: [],
    conference,
  };
};

const upsertRow = async (row: SyncRow | undefined, data: Record<string, unknown>) => {
  if (row) {
    await gql(`mutation($id: UUID!, $data: CalendarSyncUpdateInput!) { updateCalendarSync(id: $id, data: $data) { id } }`, { id: row.id, data });
    return row.id;
  }
  const { createCalendarSync } = await gql<{ createCalendarSync: { id: string } }>(`mutation($data: CalendarSyncCreateInput!) { createCalendarSync(data: $data) { id } }`, { data });
  return createCalendarSync.id;
};

const isActive = (appointment: AppointmentRecord, groupSize: number | null) => appointment.status !== 'CANCELLED' || (groupSize ?? 0) > 0;

// Brings each participant's calendar in line with the appointment. Twenty is the source of truth: the event is
// created, moved or deleted to match, and failures stay in the outbox for the retry job.
export const syncAppointment = async (appointment: AppointmentRecord) => {
  const advisorIds = nodes(appointment.participants).map((participant) => participant.advisorId);
  const participants = advisorIds.length > 0 ? advisorIds : appointment.advisorId ? [appointment.advisorId] : [];
  const existing = await gql<{ calendarSyncs: { edges: { node: SyncRow }[] } }>(
    `query($names: [String!]) { calendarSyncs(filter: { name: { in: $names } }, first: 100) { edges { node { ${SYNC_FIELDS} } } } }`,
    { names: participants.map((advisorId) => syncKey(appointment, advisorId)) },
  );
  const rows = nodes(existing.calendarSyncs);
  const groupSize = appointment.sessionKey ? (await sessionMembers(appointment.sessionKey)).length : null;
  const outcomes: string[] = [];
  let meetingUrl: string | null = null;

  for (const advisorId of participants) {
    const name = syncKey(appointment, advisorId);
    const row = rows.find((candidate) => candidate.name === name);
    const advisorData = await gql<{ advisors: { edges: { node: { id: string; name: string; email: string; workspaceMemberId: string | null } }[] } }>(
      `query($id: UUID!) { advisors(filter: { id: { eq: $id } }) { edges { node { id name email workspaceMemberId } } } }`,
      { id: advisorId },
    );
    const advisor = nodes(advisorData.advisors)[0];
    if (!advisor) continue;
    const calendars = await loadAdvisorCalendars(advisor);
    const target = row ? (calendars.find((calendar) => calendar.setting.connectionId === row.connectionId) ?? null) : bookingCalendar(calendars);
    const wanted = isActive(appointment, groupSize) ? 'UPSERT' : 'DELETE';
    if (!target) {
      if (row && row.externalEventId) {
        await upsertRow(row, { status: 'GAVE_UP', lastError: 'The calendar this event was written to is no longer connected.' });
        outcomes.push('FAILED');
      } else outcomes.push('NOT_CONNECTED');
      continue;
    }
    if (!row && wanted === 'DELETE') {
      outcomes.push('SYNCED');
      continue;
    }
    const base = {
      name,
      provider: target.provider,
      connectionId: target.setting.connectionId,
      calendarId: row?.calendarId || target.setting.bookingCalendarId,
      operation: wanted,
      appointmentId: appointment.id,
      advisorId,
    };
    try {
      if (!target.adapter) throw new CalendarAuthError('The calendar account needs reconnecting.');
      const event = await eventFor(appointment, target);
      if (wanted === 'DELETE') {
        if (row?.externalEventId) await target.adapter.deleteEvent(base.calendarId, row.externalEventId);
        await upsertRow(row, { ...base, status: 'SYNCED', lastError: '', syncedAt: new Date().toISOString(), nextAttemptAt: null });
      } else {
        const result = row?.externalEventId
          ? await target.adapter.updateEvent(base.calendarId, row.externalEventId, event)
          : await target.adapter.createEvent(base.calendarId, event);
        await upsertRow(row, { ...base, externalEventId: result.id, externalUpdatedAt: result.version ?? '', status: 'SYNCED', lastError: '', attempts: 0, syncedAt: new Date().toISOString(), nextAttemptAt: null });
        if (advisorId === appointment.advisorId && result.meetingUrl) meetingUrl = result.meetingUrl;
      }
      outcomes.push('SYNCED');
    } catch (error) {
      const attempts = (row?.attempts ?? 0) + 1;
      const permanent = error instanceof CalendarAuthError || (error instanceof CalendarRequestError && !error.retryable);
      const gaveUp = permanent || attempts >= MAX_SYNC_ATTEMPTS;
      await upsertRow(row, {
        ...base,
        status: gaveUp ? 'GAVE_UP' : 'FAILED',
        attempts,
        lastError: (error as Error).message.slice(0, 500),
        nextAttemptAt: gaveUp ? null : new Date(Date.now() + BACKOFF_MINUTES[attempts - 1] * MINUTE).toISOString(),
      });
      if (error instanceof CalendarAuthError) await updateSetting(target.setting.id, { status: 'NEEDS_RECONNECT', lastError: (error as Error).message.slice(0, 500) });
      if (gaveUp && row?.status !== 'GAVE_UP' && advisor.email)
        await sendMail({
          to: advisor.email,
          fromName: 'InventiveCRM Scheduling',
          subject: 'Action needed: a booking could not be added to your calendar',
          text: [
            `Hello ${advisor.name},`,
            '',
            `The appointment with ${appointment.customerName} on ${formatWhen(Date.parse(appointment.startsAt), Date.parse(appointment.endsAt), appointment.advisor?.timeZone || 'UTC')} is booked in Twenty, but writing it to ${target.setting.name} failed:`,
            (error as Error).message,
            '',
            error instanceof CalendarAuthError ? 'Reconnect the calendar in Scheduling > Calendar connections; the booking will be retried.' : 'It will not be retried automatically. Check the Calendar sync queue in Twenty.',
          ].join('\n'),
        }).catch(() => undefined);
      outcomes.push(gaveUp ? 'FAILED' : 'PENDING');
    }
  }

  const calendarStatus = outcomes.includes('FAILED') ? 'FAILED' : outcomes.includes('PENDING') ? 'PENDING' : outcomes.includes('SYNCED') ? 'SYNCED' : 'NOT_CONNECTED';
  const updates: Record<string, unknown> = {};
  if (calendarStatus !== appointment.calendarStatus) updates.calendarStatus = calendarStatus;
  if (meetingUrl && meetingUrl !== appointment.meetingUrl) updates.meetingUrl = meetingUrl;
  if (Object.keys(updates).length > 0)
    await gql(`mutation($id: UUID!, $data: AppointmentUpdateInput!) { updateAppointment(id: $id, data: $data) { id } }`, { id: appointment.id, data: updates });
  return { calendarStatus, meetingUrl, outcomes };
};

// Detects edits made directly in the provider. Twenty wins: a moved event is put back and a deleted one is flagged,
// so the advisor sees it rather than the customer losing the appointment silently.
export const reconcileRow = async (row: SyncRow, appointment: AppointmentRecord) => {
  if (!row.externalEventId || row.status !== 'SYNCED' || appointment.status === 'CANCELLED') return 'skipped';
  const advisorData = await gql<{ advisors: { edges: { node: { id: string; workspaceMemberId: string | null } }[] } }>(
    `query($id: UUID!) { advisors(filter: { id: { eq: $id } }) { edges { node { id workspaceMemberId } } } }`,
    { id: row.advisorId },
  );
  const advisor = nodes(advisorData.advisors)[0];
  if (!advisor) return 'skipped';
  const calendar = (await loadAdvisorCalendars(advisor)).find((candidate) => candidate.setting.connectionId === row.connectionId);
  if (!calendar?.adapter) return 'disconnected';
  const state = await calendar.adapter.getEvent(row.calendarId, row.externalEventId);
  const start = Date.parse(appointment.startsAt);
  const end = Date.parse(appointment.endsAt);
  if (!state.exists || state.cancelled) {
    await gql(`mutation($id: UUID!, $data: CalendarSyncUpdateInput!) { updateCalendarSync(id: $id, data: $data) { id } }`, {
      id: row.id,
      data: { status: 'GAVE_UP', lastError: 'Deleted in the calendar app. The appointment is still booked in Twenty.', externalEventId: '' },
    });
    await gql(`mutation($id: UUID!, $data: AppointmentUpdateInput!) { updateAppointment(id: $id, data: $data) { id } }`, { id: appointment.id, data: { calendarStatus: 'CHANGED_EXTERNALLY' } });
    return 'deleted-externally';
  }
  if (state.start !== start || state.end !== end) {
    await syncAppointment(appointment);
    await gql(`mutation($data: SchedulingAuditEventCreateInput!) { createSchedulingAuditEvent(data: $data) { id } }`, {
      data: {
        name: 'calendar.external-change-reverted',
        actor: 'calendar sync',
        appointmentId: appointment.id,
        occurredAt: new Date().toISOString(),
        details: { providerStart: state.start ? new Date(state.start).toISOString() : null, appointment: formatWhen(start, end, 'UTC') },
      },
    });
    return 'reverted';
  }
  return 'in-sync';
};

export const dueSyncRows = async (now: number) => {
  const data = await gql<{ calendarSyncs: { edges: { node: SyncRow }[] } }>(
    `query($now: DateTime!) { calendarSyncs(filter: { status: { in: [PENDING, FAILED] }, or: [{ nextAttemptAt: { is: NULL } }, { nextAttemptAt: { lte: $now } }] }, first: 100) { edges { node { ${SYNC_FIELDS} } } } }`,
    { now: new Date(now).toISOString() },
  );
  return nodes(data.calendarSyncs);
};

export const upcomingSyncedRows = async (now: number) => {
  const data = await gql<{ calendarSyncs: { edges: { node: SyncRow }[] } }>(
    `query($now: DateTime!) { calendarSyncs(filter: { status: { eq: SYNCED }, operation: { eq: UPSERT }, appointment: { endsAt: { gte: $now } } }, first: 200) { edges { node { ${SYNC_FIELDS} } } } }`,
    { now: new Date(now).toISOString() },
  ).catch(() =>
    gql<{ calendarSyncs: { edges: { node: SyncRow }[] } }>(`{ calendarSyncs(filter: { status: { eq: SYNCED }, operation: { eq: UPSERT } }, first: 200) { edges { node { ${SYNC_FIELDS} } } } }`),
  );
  return nodes(data.calendarSyncs);
};
