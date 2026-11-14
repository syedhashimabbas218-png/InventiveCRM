import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { asApplication } from 'src/lib/api';
import { unsubscribeInfo } from 'src/lib/events';
import { unsubscribePage } from 'src/lib/pages';

const handler = async (event: RoutePayload) => {
  const token = (event.pathParameters.token ?? '').slice(0, 120);
  const info = await asApplication(() => unsubscribeInfo(token)).catch(() => null);
  return new Response(unsubscribePage(info, token), {
    status: info ? 200 : 404,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.unsubscribePage,
  name: 'campaigns-unsubscribe-page',
  description: 'Public page where a contact confirms they want no more campaigns.',
  timeoutSeconds: 15,
  httpRouteTriggerSettings: { path: '/campaigns/unsubscribe/:token', httpMethod: 'GET', isAuthRequired: false },
  handler,
});
