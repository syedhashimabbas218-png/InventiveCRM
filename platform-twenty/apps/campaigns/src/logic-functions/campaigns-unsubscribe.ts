import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { asApplication } from 'src/lib/api';
import { unsubscribe } from 'src/lib/events';

// Mail providers call this for one-click unsubscribe (RFC 8058) and expect an empty success answer.
const handler = async (event: RoutePayload) => {
  const token = (event.pathParameters.token ?? '').slice(0, 120);
  const done = await asApplication(() => unsubscribe(token)).catch((error: Error) => {
    console.error(`unsubscribe failed: ${error.message}`);
    return null;
  });
  return new Response('', { status: done === null ? 500 : done ? 200 : 404, headers: { 'cache-control': 'no-store' } });
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.unsubscribeApi,
  name: 'campaigns-unsubscribe',
  description: 'Unsubscribes a contact from campaigns (page button and one-click unsubscribe).',
  timeoutSeconds: 30,
  httpRouteTriggerSettings: { path: '/campaigns/unsubscribe/:token', httpMethod: 'POST', isAuthRequired: false },
  handler,
});
