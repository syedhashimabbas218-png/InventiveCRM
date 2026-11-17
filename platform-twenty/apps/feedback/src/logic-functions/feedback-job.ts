import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { asApplication, isSignedInPerson } from 'src/lib/api';
import { expireOldRequests, failInterruptedRequests, scheduleNewRequests, sendDueRequests } from 'src/lib/requests';
import { publicBaseUrl } from 'src/lib/send';
import { loadSettings } from 'src/lib/settings';

const run = async () => {
  const settings = await loadSettings();
  if (!settings) return { skipped: 'no settings yet' };
  const now = Date.now();
  // Manual requests are sent even while automatic asking is off. A failed scan keeps its cursor for the next run
  // and must not hold back surveys that are already due.
  const scheduled = settings.enabled
    ? await scheduleNewRequests(settings, now).catch((error: Error) => {
        console.error(`feedback job: scan failed, retrying next run: ${error.message}`);
        return null;
      })
    : 0;
  const interrupted = await failInterruptedRequests(now);
  const sent = await sendDueRequests(settings, await publicBaseUrl(), now);
  const expired = await expireOldRequests(now);
  return { scheduled, interrupted, sent, expired };
};

// The cron event has no request context; route callers must be signed-in people.
const handler = async (event?: Partial<RoutePayload>) => {
  if (event?.requestContext && !isSignedInPerson(event))
    return new Response(JSON.stringify({ error: 'Only people signed in to this workspace can do this.' }), { status: 403, headers: { 'content-type': 'application/json' } });
  return asApplication(run);
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.job,
  name: 'feedback-job',
  description: 'Finds completed appointments and paid invoices, schedules feedback requests, sends those that are due and closes old ones.',
  timeoutSeconds: 300,
  cronTriggerSettings: { pattern: '*/15 * * * *' },
  httpRouteTriggerSettings: { path: '/feedback/run', httpMethod: 'POST', isAuthRequired: true },
  handler,
});
