import { defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { loadAppointment } from 'src/lib/booking';
import { TYPE_FIELDS } from 'src/lib/records';
import { dueSyncRows, reconcileRow, syncAppointment, upcomingSyncedRows } from 'src/lib/sync';

// Retries calendar writes that failed and checks upcoming events for edits made directly in Google or Outlook.
const handler = async () => {
  const now = Date.now();
  const retried: string[] = [];
  for (const appointmentId of [...new Set((await dueSyncRows(now)).map((row) => row.appointmentId).filter(Boolean) as string[])]) {
    const appointment = await loadAppointment(appointmentId, TYPE_FIELDS);
    if (!appointment) continue;
    try {
      await syncAppointment(appointment);
      retried.push(appointmentId);
    } catch (error) {
      console.error(`calendar retry ${appointmentId}: ${(error as Error).message}`);
    }
  }
  const reconciled: Record<string, number> = {};
  for (const row of (await upcomingSyncedRows(now)).slice(0, 50)) {
    if (!row.appointmentId) continue;
    const appointment = await loadAppointment(row.appointmentId, TYPE_FIELDS);
    if (!appointment) continue;
    try {
      const outcome = await reconcileRow(row, appointment);
      reconciled[outcome] = (reconciled[outcome] ?? 0) + 1;
    } catch (error) {
      reconciled.error = (reconciled.error ?? 0) + 1;
      console.error(`calendar reconcile ${row.id}: ${(error as Error).message}`);
    }
  }
  return { retried: retried.length, reconciled };
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.calendarSyncJob,
  name: 'calendar-sync-job',
  description: 'Retries failed calendar writes and reconciles upcoming events with Google and Microsoft.',
  timeoutSeconds: 300,
  httpRouteTriggerSettings: { path: '/scheduling/sync-now', httpMethod: 'POST', isAuthRequired: true },
  cronTriggerSettings: { pattern: '*/5 * * * *' },
  handler,
});
