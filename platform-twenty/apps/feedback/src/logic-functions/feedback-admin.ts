import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { AdminError, handleAdmin } from 'src/lib/admin';
import { isSignedInPerson } from 'src/lib/api';

const handler = async (event: RoutePayload<Record<string, unknown>>) => {
  if (!isSignedInPerson(event)) return new Response(JSON.stringify({ error: 'Only people signed in to this workspace can do this.' }), { status: 403, headers: { 'content-type': 'application/json' } });
  try {
    return new Response(JSON.stringify(await handleAdmin(event.body ?? {})), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch (error) {
    const status = error instanceof AdminError ? error.status : 500;
    if (status === 500) console.error(`feedback admin: ${(error as Error).stack ?? error}`);
    const message = status === 500 ? 'Something went wrong. Please try again.' : (error as Error).message;
    return new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } });
  }
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.admin,
  name: 'feedback-admin',
  description: 'Overview data for the Feedback page and asking one customer now. Signed-in users only.',
  timeoutSeconds: 60,
  httpRouteTriggerSettings: { path: '/feedback/admin', httpMethod: 'POST', isAuthRequired: true },
  handler,
});
