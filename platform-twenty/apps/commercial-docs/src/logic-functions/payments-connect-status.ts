import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { isKeyConnected } from 'src/lib/payments';

// Tells the connect page whether the key just submitted is stored. The page sends the key's hash prefix, so only
// someone holding the key can ask, and the answer is a yes or no.
const handler = async (event: RoutePayload<Record<string, unknown>>) => {
  const provider = event.body?.provider;
  const fingerprint = typeof event.body?.fingerprint === 'string' ? event.body.fingerprint : '';
  if ((provider !== 'STRIPE' && provider !== 'REVOLUT') || !/^[0-9a-f]{16}$/.test(fingerprint))
    return new Response(JSON.stringify({ connected: false }), { status: 400, headers: { 'content-type': 'application/json' } });
  const connected = await isKeyConnected(provider, fingerprint);
  return new Response(JSON.stringify({ connected }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.paymentsConnectStatus,
  name: 'payments-connect-status',
  description: 'Whether a Stripe or Revolut account is connected (yes or no), for the connect page.',
  timeoutSeconds: 15,
  httpRouteTriggerSettings: { path: '/payments/connect-status', httpMethod: 'POST', isAuthRequired: false },
  handler,
});
