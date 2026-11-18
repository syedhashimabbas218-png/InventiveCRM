import { type CronPayload, defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { MINUTE } from 'src/engine/time';
import { loadAppointment } from 'src/lib/booking';
import { inBackground } from 'src/lib/lifecycle';
import { TYPE_FIELDS } from 'src/lib/records';
import { refuseUnlessSignedIn } from 'src/lib/route-access';
import { backOffUntouchedRows, claimDueRows, dueSyncRows, giveUpRows, markChecked, RECONCILE_DAYS, reconcileRow, syncAppointment, upcomingSyncedRows } from 'src/lib/sync';

const LEASE_MINUTES = 10;

const syncLiveOrDeleted = async (appointmentId: string) => {
  const live = await loadAppointment(appointmentId, TYPE_FIELDS);
  if (live) return syncAppointment(live);
  const deleted = await loadAppointment(appointmentId, TYPE_FIELDS, { deleted: true });
  if (!deleted) return null;
  return syncAppointment({ ...deleted, status: 'CANCELLED' }, { updateAppointmentRecord: false });
};

// Retries calendar writes that failed and checks upcoming events for edits made directly in Google or Outlook.
const run = async () => {
  const now = Date.now();
  const leaseUntil = new Date(now + LEASE_MINUTES * MINUTE).toISOString();
  const claimed = await claimDueRows((await dueSyncRows(now)).map((row) => row.id), now, leaseUntil);
  await giveUpRows(claimed.filter((row) => !row.appointmentId).map((row) => row.id), 'The appointment no longer exists.');
  const retried: string[] = [];
  const interrupted = new Set<string>();
  for (const appointmentId of [...new Set(claimed.map((row) => row.appointmentId).filter(Boolean) as string[])]) {
    const rowIds = claimed.filter((row) => row.appointmentId === appointmentId).map((row) => row.id);
    try {
      if (await syncLiveOrDeleted(appointmentId)) retried.push(appointmentId);
      else await giveUpRows(rowIds, 'The appointment no longer exists.');
    } catch (error) {
      // Left leased: these rows come due again when the lease ends.
      for (const rowId of rowIds) interrupted.add(rowId);
      console.error(`calendar retry ${appointmentId}: ${(error as Error).message}`);
    }
  }
  const backedOff = await backOffUntouchedRows(claimed.map((row) => row.id).filter((rowId) => !interrupted.has(rowId)), leaseUntil, now);

  const reconciled: Record<string, number> = {};
  const until = now + RECONCILE_DAYS * 24 * 60 * MINUTE;
  for (const row of await upcomingSyncedRows(now)) {
    try {
      const appointment = row.appointmentId ? await loadAppointment(row.appointmentId, TYPE_FIELDS) : null;
      const upcoming = appointment && Date.parse(appointment.endsAt) >= now && Date.parse(appointment.startsAt) <= until;
      const outcome = upcoming ? await reconcileRow(row, appointment) : 'skipped';
      reconciled[outcome] = (reconciled[outcome] ?? 0) + 1;
    } catch (error) {
      reconciled.error = (reconciled.error ?? 0) + 1;
      console.error(`calendar reconcile ${row.id}: ${(error as Error).message}`);
    }
    await markChecked(row.id).catch(() => undefined);
  }
  return { retried: retried.length, backedOff, reconciled };
};

const handler = (event: RoutePayload | CronPayload) => refuseUnlessSignedIn(event) ?? inBackground('calendar-sync-job', run);

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.calendarSyncJob,
  name: 'calendar-sync-job',
  description: 'Retries failed calendar writes and reconciles upcoming events with Google and Microsoft.',
  timeoutSeconds: 300,
  httpRouteTriggerSettings: { path: '/scheduling/sync-now', httpMethod: 'POST', isAuthRequired: true },
  cronTriggerSettings: { pattern: '2-59/10 * * * *' },
  handler,
});
