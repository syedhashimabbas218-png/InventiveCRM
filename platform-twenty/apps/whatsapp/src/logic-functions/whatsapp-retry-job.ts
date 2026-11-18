import { type CronPayload, defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { asApplication, isSignedInPerson } from 'src/lib/api';
import { runRetries } from 'src/lib/retry';

// Cron runs carry no request; a route call must come from a signed-in person, not an API key.
const handler = async (event: RoutePayload | CronPayload) => {
  if ('requestContext' in event && !isSignedInPerson(event)) return new Response(JSON.stringify({ error: 'Only people signed in to this workspace can start a run.' }), { status: 403, headers: { 'content-type': 'application/json' } });
  return asApplication(() => runRetries());
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.retryJob,
  name: 'whatsapp-retry-job',
  description: 'Catches up on WhatsApp events missed while the CRM was unreachable, and sends notifications that had to wait (a teammate chatting with the customer, Meta’s limit, pacing).',
  timeoutSeconds: 240,
  cronTriggerSettings: { pattern: '9-59/15 * * * *' },
  httpRouteTriggerSettings: { path: '/whatsapp/retry', httpMethod: 'POST', isAuthRequired: true },
  handler,
});
