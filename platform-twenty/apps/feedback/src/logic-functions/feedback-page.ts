import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { surveyPage } from 'src/lib/page';
import { publicBaseUrl } from 'src/lib/send';

const handler = async (event: RoutePayload) =>
  new Response(surveyPage({ base: await publicBaseUrl(), token: (event.pathParameters.token ?? '').slice(0, 120) }), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.page,
  name: 'feedback-page',
  description: 'Public page where a customer answers a feedback request.',
  timeoutSeconds: 15,
  httpRouteTriggerSettings: { path: '/feedback/:token', httpMethod: 'GET', isAuthRequired: false },
  handler,
});
