import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { asApplication } from 'src/lib/api';
import { handleResendEvent } from 'src/lib/events';
import { verifyWebhookToken } from 'src/lib/tokens';

const handler = async (event: RoutePayload<Record<string, unknown>>) => {
  if (!verifyWebhookToken(event.pathParameters.token ?? '')) return new Response('', { status: 404 });
  try {
    const result = await asApplication(() => handleResendEvent(event.body ?? {}));
    return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (error) {
    // A 500 makes Resend retry later, which is what we want for a passing database or API problem.
    console.error(`resend webhook: ${(error as Error).stack ?? error}`);
    return new Response('', { status: 500 });
  }
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.webhook,
  name: 'campaigns-webhook',
  description: 'Receives delivery, open, click, bounce and spam-complaint events from Resend.',
  timeoutSeconds: 30,
  httpRouteTriggerSettings: { path: '/campaigns/webhook/:token', httpMethod: 'POST', isAuthRequired: false },
  handler,
});
