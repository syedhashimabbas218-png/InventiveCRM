import { type CronPayload, defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { dueReminderIntervals, largestReminderMinutes, withRemindersSent } from 'src/engine/reminders';
import { MINUTE } from 'src/engine/time';
import { gql } from 'src/lib/api';
import { loadAppointment } from 'src/lib/booking';
import { audit, inBackground, notifyCustomer } from 'src/lib/lifecycle';
import { allPages, PAGE_INFO, type Page } from 'src/lib/pagination';
import { TYPE_FIELDS } from 'src/lib/records';
import { refuseUnlessSignedIn } from 'src/lib/route-access';

type Upcoming = { id: string; startsAt: string; remindersSent: string | null; appointmentType: { reminderMinutes: string } | null };

const sentFilter = (remindersSent: string | null) => (remindersSent ? { remindersSent: { eq: remindersSent } } : { or: [{ remindersSent: { is: 'NULL' } }, { remindersSent: { eq: '' } }] });

// A conditional update returns only the rows it changed: if a cron run and a manual run overlap, one sends.
const setRemindersSent = async (id: string, expected: string | null, value: string, statuses: string[]) => {
  const data = await gql<{ updateAppointments: { id: string }[] }>(
    `mutation($filter: AppointmentFilterInput!, $data: AppointmentUpdateInput!) { updateAppointments(filter: $filter, data: $data) { id } }`,
    { filter: { id: { eq: id }, status: { in: statuses }, ...sentFilter(expected) }, data: { remindersSent: value } },
  );
  return data.updateAppointments.length > 0;
};

const run = async () => {
  const now = Date.now();
  const types = await allPages((after) =>
    gql<{ appointmentTypes: Page<{ reminderMinutes: string | null }> }>(
      `query($after: String) { appointmentTypes(first: 200, after: $after) { edges { node { reminderMinutes } } ${PAGE_INFO} } }`,
      { after },
    ).then((data) => data.appointmentTypes),
  );
  const horizonMinutes = largestReminderMinutes(types.map((type) => type.reminderMinutes));
  if (horizonMinutes === 0) return { sent: 0 };
  const upcoming = await allPages((after) =>
    gql<{ appointments: Page<Upcoming> }>(
      `query($from: DateTime!, $to: DateTime!, $after: String) {
        appointments(filter: { status: { in: [CONFIRMED, RESCHEDULED] }, and: [{ startsAt: { gt: $from } }, { startsAt: { lt: $to } }] }, orderBy: [{ startsAt: AscNullsLast }], first: 200, after: $after) {
          edges { node { id startsAt remindersSent appointmentType { reminderMinutes } } } ${PAGE_INFO}
        }
      }`,
      { from: new Date(now).toISOString(), to: new Date(now + horizonMinutes * MINUTE).toISOString(), after },
    ).then((data) => data.appointments),
  );
  let sent = 0;
  for (const appointment of upcoming) {
    const due = dueReminderIntervals(appointment.appointmentType?.reminderMinutes, appointment.remindersSent, Date.parse(appointment.startsAt), now);
    if (due.length === 0) continue;
    const claimed = withRemindersSent(appointment.remindersSent, due);
    if (!(await setRemindersSent(appointment.id, appointment.remindersSent, claimed, ['CONFIRMED', 'RESCHEDULED']))) continue;
    const full = await loadAppointment(appointment.id, TYPE_FIELDS);
    if (!full) continue;
    try {
      await notifyCustomer(full, 'reminder');
    } catch (error) {
      // Only a reminder that went out counts as sent; this one is tried again on the next run.
      await setRemindersSent(appointment.id, claimed, appointment.remindersSent ?? '', ['CONFIRMED', 'RESCHEDULED']);
      await audit(appointment.id, 'notification.failed', 'system', { what: 'reminder', error: (error as Error).message.slice(0, 500) });
      continue;
    }
    sent += 1;
    await audit(appointment.id, 'appointment.reminder-sent', 'system', { minutesBefore: Math.min(...due) });
  }
  return { sent };
};

const handler = (event: RoutePayload | CronPayload) => refuseUnlessSignedIn(event) ?? inBackground('reminders-job', run);

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.remindersJob,
  name: 'reminders-job',
  description: 'Emails customers before their appointments at the intervals set on each appointment type.',
  timeoutSeconds: 300,
  httpRouteTriggerSettings: { path: '/scheduling/reminders-now', httpMethod: 'POST', isAuthRequired: true },
  cronTriggerSettings: { pattern: '4-59/15 * * * *' },
  handler,
});
