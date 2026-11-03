import { defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { MINUTE } from 'src/engine/time';
import { gql, nodes } from 'src/lib/api';
import { loadAppointment, updateAppointment } from 'src/lib/booking';
import { audit, notifyCustomer } from 'src/lib/lifecycle';
import { TYPE_FIELDS } from 'src/lib/records';

const intervals = (value: string | null | undefined) =>
  (value ?? '')
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((minutes) => Number.isFinite(minutes) && minutes > 0);

// Each interval is sent once; if several fall due together (for example after downtime) only the nearest is sent.
const handler = async () => {
  const now = Date.now();
  const data = await gql<{ appointments: { edges: { node: { id: string; startsAt: string; remindersSent: string; appointmentType: { reminderMinutes: string } | null } }[] } }>(
    `query($from: DateTime!, $to: DateTime!) { appointments(filter: { status: { in: [CONFIRMED, RESCHEDULED] }, and: [{ startsAt: { gt: $from } }, { startsAt: { lt: $to } }] }, first: 500) { edges { node { id startsAt remindersSent appointmentType { reminderMinutes } } } } }`,
    { from: new Date(now).toISOString(), to: new Date(now + 90 * 24 * 60 * MINUTE).toISOString() },
  );
  let sent = 0;
  for (const appointment of nodes(data.appointments)) {
    const start = Date.parse(appointment.startsAt);
    const done = new Set(intervals(appointment.remindersSent));
    const due = intervals(appointment.appointmentType?.reminderMinutes).filter((minutes) => !done.has(minutes) && now >= start - minutes * MINUTE);
    if (due.length === 0) continue;
    const full = await loadAppointment(appointment.id, TYPE_FIELDS);
    if (!full) continue;
    try {
      await notifyCustomer(full, 'reminder');
      sent += 1;
      await audit(appointment.id, 'appointment.reminder-sent', 'system', { minutesBefore: Math.min(...due) });
    } catch (error) {
      await audit(appointment.id, 'notification.failed', 'system', { what: 'reminder', error: (error as Error).message.slice(0, 500) });
    }
    await updateAppointment(appointment.id, { remindersSent: [...done, ...due].sort((a, b) => b - a).join(',') });
  }
  return { sent };
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.remindersJob,
  name: 'reminders-job',
  description: 'Emails customers before their appointments at the intervals set on each appointment type.',
  timeoutSeconds: 300,
  httpRouteTriggerSettings: { path: '/scheduling/reminders-now', httpMethod: 'POST', isAuthRequired: true },
  cronTriggerSettings: { pattern: '*/10 * * * *' },
  handler,
});
