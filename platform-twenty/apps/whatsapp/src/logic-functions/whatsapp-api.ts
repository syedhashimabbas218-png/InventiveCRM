import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { isSignedInPerson } from 'src/lib/api';
import { handleInbox, InboxError } from 'src/lib/inbox';

const handler = async (event: RoutePayload<Record<string, unknown>>) => {
  if (!isSignedInPerson(event)) return new Response(JSON.stringify({ error: 'WhatsApp is for people signed in to this workspace.' }), { status: 403, headers: { 'content-type': 'application/json' } });
  try {
    return new Response(JSON.stringify(await handleInbox(event.body ?? {})), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch (error) {
    const status = error instanceof InboxError ? error.status : 500;
    if (status === 500) console.error(`whatsapp api: ${(error as Error).stack ?? error}`);
    const message = status === 500 ? 'Something went wrong. Please try again.' : (error as Error).message;
    return new Response(JSON.stringify({ error: message, ...(error instanceof InboxError ? error.extra : {}) }), { status, headers: { 'content-type': 'application/json' } });
  }
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.api,
  name: 'whatsapp-api',
  description: 'Actions behind the WhatsApp inbox: send, templates, mark read, assign, close and reopen. Signed-in users only.',
  timeoutSeconds: 30,
  httpRouteTriggerSettings: { path: '/whatsapp/api', httpMethod: 'POST', isAuthRequired: true },
  handler,
});
