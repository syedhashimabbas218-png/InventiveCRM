import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { isKeyConnected } from 'src/lib/settings';

// The page sends the key's hash prefix, so only someone holding the key can ask, and the answer is yes or no.
const handler = async (event: RoutePayload<Record<string, unknown>>) => {
  const fingerprint = typeof event.body?.fingerprint === 'string' ? event.body.fingerprint : '';
  if (!/^[0-9a-f]{16}$/.test(fingerprint)) return new Response(JSON.stringify({ connected: false }), { status: 400, headers: { 'content-type': 'application/json' } });
  return new Response(JSON.stringify({ connected: await isKeyConnected(fingerprint) }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.connectStatus,
  name: 'whatsapp-connect-status',
  description: 'Whether an InventiveChat key is connected (yes or no), for the connect page.',
  timeoutSeconds: 15,
  httpRouteTriggerSettings: { path: '/whatsapp/connect-status', httpMethod: 'POST', isAuthRequired: false },
  handler,
});
