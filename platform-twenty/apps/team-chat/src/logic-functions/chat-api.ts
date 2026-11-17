import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { isSignedInPerson } from 'src/lib/api';
import { ChatError, handleChat } from 'src/lib/chat';

const handler = async (event: RoutePayload<Record<string, unknown>>) => {
  if (!isSignedInPerson(event)) return new Response(JSON.stringify({ error: 'Team chat is for people signed in to this workspace.' }), { status: 403, headers: { 'content-type': 'application/json' } });
  try {
    return new Response(JSON.stringify(await handleChat(event.body ?? {})), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch (error) {
    const status = error instanceof ChatError ? error.status : 500;
    if (status === 500) console.error(`team chat: ${(error as Error).stack ?? error}`);
    const message = status === 500 ? 'Something went wrong. Please try again.' : (error as Error).message;
    return new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } });
  }
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.api,
  name: 'team-chat-api',
  description: 'Everything behind Team chat: channels, messages, mentions and read state. Signed-in users only.',
  timeoutSeconds: 30,
  httpRouteTriggerSettings: { path: '/chat/api', httpMethod: 'POST', isAuthRequired: true },
  handler,
});
