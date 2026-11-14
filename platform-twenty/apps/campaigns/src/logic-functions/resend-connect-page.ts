import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { connectPage, isTrustedCallback } from 'src/lib/pages';

const handler = async (event: RoutePayload) => {
  const callback = event.queryStringParameters?.callback ?? '';
  if (!isTrustedCallback(callback, process.env.TWENTY_API_URL))
    return new Response('This link is not valid. Start again from Settings, Accounts.', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  return new Response(connectPage(callback), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.connectPage,
  name: 'resend-connect-page',
  description: 'Page where a client pastes their Resend API key; it posts only to Twenty’s own connection callback.',
  timeoutSeconds: 15,
  httpRouteTriggerSettings: { path: '/campaigns/connect', httpMethod: 'GET', isAuthRequired: false },
  handler,
});
