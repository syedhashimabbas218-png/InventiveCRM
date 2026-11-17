import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { AdminError, handleAdmin } from 'src/lib/admin';
import { isSignedInPerson } from 'src/lib/api';

const handler = async (event: RoutePayload<Record<string, unknown>>) => {
  if (!isSignedInPerson(event)) return new Response(JSON.stringify({ error: 'Campaign Studio is for people signed in to this workspace.' }), { status: 403, headers: { 'content-type': 'application/json' } });
  try {
    return new Response(JSON.stringify(await handleAdmin(event.body ?? {})), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch (error) {
    const status = error instanceof AdminError ? error.status : 500;
    if (status === 500) console.error(`campaigns admin: ${(error as Error).stack ?? error}`);
    const message = status === 500 ? 'Something went wrong. Please try again.' : (error as Error).message;
    return new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } });
  }
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.admin,
  name: 'campaigns-admin',
  description: 'Everything behind Campaign Studio: drafts, previews, test sends, scheduling, lists and reports. Signed-in users only.',
  timeoutSeconds: 60,
  httpRouteTriggerSettings: { path: '/campaigns/admin', httpMethod: 'POST', isAuthRequired: true },
  handler,
});
