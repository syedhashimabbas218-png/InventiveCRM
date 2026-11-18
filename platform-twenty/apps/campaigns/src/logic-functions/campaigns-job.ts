import { type CronPayload, defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { asApplication, isSignedInPerson } from 'src/lib/api';
import { runCampaigns } from 'src/lib/engine';

// Cron runs carry no request; a route call must come from a signed-in person, not an API key.
const handler = async (event: RoutePayload | CronPayload) => {
  if ('requestContext' in event && !isSignedInPerson(event)) return new Response(JSON.stringify({ error: 'Only people signed in to this workspace can start a run.' }), { status: 403, headers: { 'content-type': 'application/json' } });
  return asApplication(() => runCampaigns());
};

// Every two minutes with a run budget under two minutes; a manual run can overlap one, which the per-campaign lease allows for.
export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.job,
  name: 'campaigns-job',
  description: 'Starts campaigns that are due, sends the next batches and refreshes campaign results.',
  timeoutSeconds: 110,
  cronTriggerSettings: { pattern: '1-59/5 * * * *' },
  httpRouteTriggerSettings: { path: '/campaigns/run', httpMethod: 'POST', isAuthRequired: true },
  handler,
});
