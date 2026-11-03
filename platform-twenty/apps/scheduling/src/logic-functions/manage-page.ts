import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { publicBaseUrl } from 'src/lib/notify';
import { bookingPage } from 'src/lib/page';

const handler = async (event: RoutePayload) =>
  new Response(bookingPage({ base: await publicBaseUrl(), slug: '', token: (event.pathParameters.token ?? '').slice(0, 120), mode: 'manage' }), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.managePage,
  name: 'manage-page',
  description: 'Lets a customer reschedule or cancel through the signed link in their confirmation email.',
  timeoutSeconds: 15,
  httpRouteTriggerSettings: { path: '/booking/manage/:token', httpMethod: 'GET', isAuthRequired: false },
  handler,
});
