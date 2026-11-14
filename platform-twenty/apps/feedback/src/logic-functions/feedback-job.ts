import { defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { asApplication } from 'src/lib/api';
import { expireOldRequests, scheduleNewRequests, sendDueRequests } from 'src/lib/requests';
import { publicBaseUrl } from 'src/lib/send';
import { loadSettings } from 'src/lib/settings';

const run = async () => {
  const settings = await loadSettings();
  if (!settings) return { skipped: 'no settings yet' };
  const now = Date.now();
  // Manual requests are sent even while automatic asking is off.
  const scheduled = settings.enabled ? await scheduleNewRequests(settings, now) : 0;
  const sent = await sendDueRequests(settings, await publicBaseUrl(), now);
  const expired = await expireOldRequests(now);
  return { scheduled, sent, expired };
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.job,
  name: 'feedback-job',
  description: 'Finds completed appointments and paid invoices, schedules feedback requests, sends those that are due and closes old ones.',
  timeoutSeconds: 300,
  cronTriggerSettings: { pattern: '*/15 * * * *' },
  httpRouteTriggerSettings: { path: '/feedback/run', httpMethod: 'POST', isAuthRequired: true },
  handler: () => asApplication(run),
});
