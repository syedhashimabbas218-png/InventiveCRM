import { heldInterval } from 'src/engine/availability';
import { reservationKeys } from 'src/engine/slots';
import { MINUTE } from 'src/engine/time';
import { gql, nodes } from 'src/lib/api';
import { type AppointmentRecord, loadAppointment, releaseReservations, updateAppointment } from 'src/lib/booking';
import { buildIcs, formatWhen, manageUrl, sendMail } from 'src/lib/notify';
import { loadSettings, TYPE_FIELDS } from 'src/lib/records';
import { syncAppointment } from 'src/lib/sync';
import { newNonce } from 'src/lib/tokens';

export const audit = (appointmentId: string, name: string, actor: string, details: Record<string, unknown> = {}) =>
  gql(`mutation($data: SchedulingAuditEventCreateInput!) { createSchedulingAuditEvent(data: $data) { id } }`, {
    data: { name, actor, appointmentId, occurredAt: new Date().toISOString(), details },
  });

const reservationKeysFor = async (appointmentId: string) => {
  const data = await gql<{ slotReservations: { edges: { node: { key: string } }[] } }>(
    `query($id: UUID!) { slotReservations(filter: { appointmentId: { eq: $id } }, first: 1000) { edges { node { key } } } }`,
    { id: appointmentId },
  );
  return nodes(data.slotReservations).map((row) => row.key);
};

const participantIds = (appointment: AppointmentRecord) => {
  const ids = nodes(appointment.participants).map((participant) => participant.advisorId);
  return ids.length > 0 ? ids : appointment.advisorId ? [appointment.advisorId] : [];
};

const wantedRows = (appointment: AppointmentRecord) => {
  const type = appointment.appointmentType;
  const held = heldInterval(Date.parse(appointment.startsAt), Date.parse(appointment.endsAt), type?.bufferBeforeMinutes ?? 0, type?.bufferAfterMinutes ?? 0);
  return participantIds(appointment).flatMap((advisorId) => reservationKeys(advisorId, held).map((key) => ({ key, advisorId, startsAt: key.split('|')[1], appointmentId: appointment.id })));
};

// Makes the appointment hold exactly its own time. Returns false when the time clashes with another booking; the
// appointment's previous holds are then left as they were.
const claimTime = async (appointment: AppointmentRecord) => {
  if (appointment.sessionKey) return true;
  const current = new Set(await reservationKeysFor(appointment.id));
  const wanted = wantedRows(appointment);
  const missing = wanted.filter((row) => !current.has(row.key));
  if (missing.length > 0) {
    try {
      await gql(`mutation($data: [SlotReservationCreateInput!]!) { createSlotReservations(data: $data) { id } }`, { data: missing });
    } catch (error) {
      if (/duplicate|unique constraint/i.test((error as Error).message)) return false;
      throw error;
    }
  }
  const keep = new Set(wanted.map((row) => row.key));
  const stale = [...current].filter((key) => !keep.has(key));
  if (stale.length > 0) await releaseReservations({ keys: stale });
  return true;
};

const advisorEmail = async (advisorId: string | null) => {
  if (!advisorId) return null;
  const data = await gql<{ advisors: { edges: { node: { name: string; email: string } }[] } }>(`query($id: UUID!) { advisors(filter: { id: { eq: $id } }) { edges { node { name email } } } }`, { id: advisorId });
  return nodes(data.advisors)[0] ?? null;
};

type Kind = 'confirmed' | 'requested' | 'rescheduled' | 'cancelled' | 'reminder' | 'approved';

const customerMessage = async (appointment: AppointmentRecord, kind: Kind) => {
  const type = appointment.appointmentType;
  const when = formatWhen(Date.parse(appointment.startsAt), Date.parse(appointment.endsAt), appointment.customerTimeZone);
  const where = appointment.meetingUrl ? `Join: ${appointment.meetingUrl}` : appointment.location ? `Where: ${appointment.location}` : '';
  const link = kind === 'cancelled' ? '' : `To reschedule or cancel: ${await manageUrl(appointment)}`;
  const intro: Record<Kind, string> = {
    confirmed: `Your ${type?.name ?? 'appointment'} is booked.`,
    approved: `Your ${type?.name ?? 'appointment'} has been confirmed.`,
    requested: `We have received your request for ${type?.name ?? 'an appointment'}. You will hear from us once it is confirmed.`,
    rescheduled: `Your ${type?.name ?? 'appointment'} has moved.`,
    cancelled: `Your ${type?.name ?? 'appointment'} has been cancelled.`,
    reminder: `A reminder of your ${type?.name ?? 'appointment'}.`,
  };
  const subject: Record<Kind, string> = {
    confirmed: `Booked: ${type?.name ?? 'appointment'} on ${when}`,
    approved: `Confirmed: ${type?.name ?? 'appointment'} on ${when}`,
    requested: `Request received: ${type?.name ?? 'appointment'}`,
    rescheduled: `Moved: ${type?.name ?? 'appointment'} now on ${when}`,
    cancelled: `Cancelled: ${type?.name ?? 'appointment'} on ${when}`,
    reminder: `Reminder: ${type?.name ?? 'appointment'} on ${when}`,
  };
  const text = [
    `Hello ${appointment.customerName},`,
    '',
    intro[kind],
    '',
    `When: ${when}`,
    appointment.advisor ? `With: ${appointment.advisor.name}` : '',
    where,
    kind === 'confirmed' && type?.confirmationMessage ? `\n${type.confirmationMessage}` : '',
    '',
    link,
  ]
    .filter((line, index, all) => line !== '' || all[index - 1] !== '')
    .join('\n');
  return { subject: subject[kind], text };
};

export const notifyCustomer = async (appointment: AppointmentRecord, kind: Kind) => {
  if (!appointment.customerEmail) return;
  const settings = await loadSettings();
  const advisor = await advisorEmail(appointment.advisorId);
  const fromName = settings.senderName || advisor?.name || 'Bookings';
  const message = await customerMessage(appointment, kind);
  const withIcs = kind !== 'requested' && kind !== 'reminder';
  await sendMail({
    to: appointment.customerEmail,
    subject: message.subject,
    text: message.text,
    replyTo: advisor?.email,
    fromName,
    ics: withIcs
      ? {
          method: kind === 'cancelled' ? 'CANCEL' : 'REQUEST',
          content: buildIcs({
            appointment,
            method: kind === 'cancelled' ? 'CANCEL' : 'REQUEST',
            summary: `${appointment.appointmentType?.name ?? 'Appointment'}${advisor ? ` with ${advisor.name}` : ''}`,
            organizer: { name: fromName, email: process.env.SMTP_FROM_ADDRESS ?? '' },
            description: message.text,
          }),
        }
      : null,
  });
};

export const notifyAdvisors = async (appointment: AppointmentRecord, subject: string, lines: string[]) => {
  const settings = await loadSettings();
  if (!settings.notifyAdvisors) return;
  for (const advisorId of participantIds(appointment)) {
    const advisor = await advisorEmail(advisorId);
    if (!advisor?.email) continue;
    await sendMail({
      to: advisor.email,
      subject,
      fromName: 'InventiveCRM Scheduling',
      text: [
        `Hello ${advisor.name},`,
        '',
        ...lines,
        '',
        `When: ${formatWhen(Date.parse(appointment.startsAt), Date.parse(appointment.endsAt), appointment.advisor?.timeZone || 'Europe/London')}`,
        `Customer: ${appointment.customerName} <${appointment.customerEmail}>${appointment.customerPhone ? `, ${appointment.customerPhone}` : ''}`,
        appointment.location ? `Where: ${appointment.location}` : '',
      ].join('\n'),
    });
  }
};

// Emails must never undo a booking: a failure is written to the audit log instead.
const safely = async (appointmentId: string, what: string, action: () => Promise<unknown>) => {
  try {
    await action();
  } catch (error) {
    await audit(appointmentId, 'notification.failed', 'system', { what, error: (error as Error).message.slice(0, 500) }).catch(() => undefined);
  }
};

const reload = (id: string) => loadAppointment(id, TYPE_FIELDS);

export const onAppointmentCreated = async (id: string) => {
  let appointment = await reload(id);
  if (!appointment || appointment.status === 'CANCELLED') return { skipped: true };
  const fixes: Record<string, unknown> = {};
  if (!appointment.manageNonce) fixes.manageNonce = newNonce();
  if (!appointment.endsAt && appointment.appointmentType) fixes.endsAt = new Date(Date.parse(appointment.startsAt) + appointment.appointmentType.durationMinutes * MINUTE).toISOString();
  if (Object.keys(fixes).length > 0) {
    await updateAppointment(id, fixes);
    appointment = (await reload(id)) as AppointmentRecord;
  }
  if (nodes(appointment.participants).length === 0 && appointment.advisorId) {
    await gql(`mutation($data: AppointmentParticipantCreateInput!) { createAppointmentParticipant(data: $data) { id } }`, {
      data: { name: appointment.advisor?.name ?? '', participantRole: 'HOST', appointmentId: id, advisorId: appointment.advisorId },
    });
    appointment = (await reload(id)) as AppointmentRecord;
  }

  // Records made by hand in Twenty claim their time here; booking-page records already hold it.
  if ((await reservationKeysFor(id)).length === 0 && !appointment.sessionKey && !(await claimTime(appointment))) {
    await updateAppointment(id, { status: 'PENDING', notes: 'Overlaps another booking for this advisor. Move it or confirm the overlap.' });
    await audit(id, 'appointment.conflict', 'system', { startsAt: appointment.startsAt });
    await safely(id, 'advisor conflict email', () => notifyAdvisors(appointment as AppointmentRecord, 'Appointment overlaps another booking', ['An appointment added in the CRM overlaps another booking. It is on hold as Pending until it is moved.']));
    return { conflict: true };
  }

  await audit(id, 'appointment.created', 'system', { status: appointment.status, advisorId: appointment.advisorId });
  if (appointment.advisorId) await audit(id, 'advisor.assigned', 'system', { advisorId: appointment.advisorId });
  const synced = await syncAppointment(appointment);
  appointment = (await reload(id)) as AppointmentRecord;
  await safely(id, 'customer confirmation', () => notifyCustomer(appointment as AppointmentRecord, appointment?.status === 'PENDING' ? 'requested' : 'confirmed'));
  await safely(id, 'advisor notification', () =>
    notifyAdvisors(appointment as AppointmentRecord, `New booking: ${appointment?.appointmentType?.name ?? 'appointment'}`, [
      appointment?.status === 'PENDING' ? 'A booking is waiting for your approval (set it to Confirmed in Twenty).' : 'You have a new booking.',
    ]),
  );
  await updateAppointment(id, { notifiedStartsAt: appointment.startsAt });
  return { synced };
};

type Snapshot = { status?: string | null; startsAt?: string | null; endsAt?: string | null; advisorId?: string | null; notifiedStartsAt?: string | null };

export const onAppointmentUpdated = async (id: string, before: Snapshot, after: Snapshot) => {
  let appointment = await reload(id);
  if (!appointment) return { skipped: true };

  if (after.status === 'CANCELLED' && before.status !== 'CANCELLED') {
    await releaseReservations({ appointmentId: id });
    await audit(id, 'appointment.cancelled', 'system', {});
    await syncAppointment(appointment);
    await safely(id, 'customer cancellation', () => notifyCustomer(appointment as AppointmentRecord, 'cancelled'));
    await safely(id, 'advisor cancellation', () => notifyAdvisors(appointment as AppointmentRecord, 'Appointment cancelled', ['This appointment has been cancelled.']));
    return { cancelled: true };
  }
  if (appointment.status === 'CANCELLED') return { skipped: true };

  if (after.advisorId && before.advisorId && after.advisorId !== before.advisorId) {
    const participants = nodes(appointment.participants);
    const host = participants.find((participant) => participant.participantRole === 'HOST');
    await gql(`mutation($filter: AppointmentParticipantFilterInput!, $data: AppointmentParticipantUpdateInput!) { updateAppointmentParticipants(filter: $filter, data: $data) { id } }`, {
      filter: { appointmentId: { eq: id }, advisorId: { eq: host?.advisorId ?? before.advisorId } },
      data: { advisorId: after.advisorId },
    });
    appointment = (await reload(id)) as AppointmentRecord;
    await releaseReservations({ appointmentId: id });
    if (!(await claimTime(appointment))) {
      await updateAppointment(id, { advisorId: before.advisorId });
      await claimTime((await reload(id)) as AppointmentRecord);
      await audit(id, 'advisor.reassignment-rejected', 'system', { wanted: after.advisorId });
      return { rejected: true };
    }
    await audit(id, 'advisor.assigned', 'system', { from: before.advisorId, to: after.advisorId });
    await syncAppointment(appointment);
    await safely(id, 'new advisor email', () => notifyAdvisors(appointment as AppointmentRecord, 'Appointment assigned to you', ['This appointment has been assigned to you.']));
  }

  const moved = after.startsAt !== before.startsAt || after.endsAt !== before.endsAt;
  if (moved) {
    if (!(await claimTime(appointment))) {
      await updateAppointment(id, { startsAt: before.startsAt, endsAt: before.endsAt });
      await audit(id, 'appointment.move-rejected', 'system', { wanted: { startsAt: after.startsAt, endsAt: after.endsAt } });
      return { rejected: true };
    }
    await syncAppointment(appointment);
    if (appointment.notifiedStartsAt !== appointment.startsAt) {
      await audit(id, 'appointment.rescheduled', 'system', { from: before.startsAt, to: after.startsAt });
      await safely(id, 'customer reschedule', () => notifyCustomer(appointment as AppointmentRecord, 'rescheduled'));
      await safely(id, 'advisor reschedule', () => notifyAdvisors(appointment as AppointmentRecord, 'Appointment moved', ['This appointment has moved.']));
      await updateAppointment(id, { notifiedStartsAt: appointment.startsAt });
    }
  }

  if (after.status !== before.status) {
    await audit(id, `appointment.${String(after.status).toLowerCase()}`, 'system', { from: before.status });
    if (after.status === 'CONFIRMED' && before.status === 'PENDING') {
      await syncAppointment(appointment);
      await safely(id, 'customer approval', () => notifyCustomer(appointment as AppointmentRecord, 'approved'));
    }
  }
  return { ok: true };
};

// Unexpected failures are recorded in Twenty, where operators can see and filter them, as well as in the function log.
export const recordSystemError = (source: string, error: unknown) =>
  gql(`mutation($data: SchedulingAuditEventCreateInput!) { createSchedulingAuditEvent(data: $data) { id } }`, {
    data: { name: 'system.error', actor: source, occurredAt: new Date().toISOString(), details: { message: (error as Error).message?.slice(0, 1000), stack: (error as Error).stack?.slice(0, 4000) } },
  }).catch(() => undefined);
