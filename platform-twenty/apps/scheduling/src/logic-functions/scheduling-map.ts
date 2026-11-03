import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { staffMapPage } from 'src/lib/staff-map';

// Public route guarded by a short-lived signed ticket, because the map needs a real browser page outside the app frame.
const handler = async (event: RoutePayload) => {
  const { status, body } = await staffMapPage(String(event.queryStringParameters?.ticket ?? '').slice(0, 200));
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.schedulingMap,
  name: 'scheduling-map',
  description: 'Staff map of advisors, offices, travel radii and service areas.',
  timeoutSeconds: 20,
  httpRouteTriggerSettings: { path: '/scheduling/map', httpMethod: 'GET', isAuthRequired: false },
  handler,
});
