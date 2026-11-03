import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { recordSystemError } from 'src/lib/lifecycle';
import { errorResponse, handlePublicApi } from 'src/lib/public-api';

const handler = async (event: RoutePayload<Record<string, unknown>>) => {
  try {
    const result = await handlePublicApi(event.body ?? {}, event.headers);
    return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch (error) {
    const { status, body } = errorResponse(error);
    if (status === 500) await recordSystemError('booking-api', error);
    if (status === 500) console.error(`booking api: ${(error as Error).stack ?? error}`);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(status === 429 ? { 'retry-after': '60' } : {}) },
    });
  }
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.bookingApi,
  name: 'booking-api',
  description: 'Public booking API: page details, address search, nearby advisors, free times, booking, and the customer manage, cancel and reschedule actions.',
  timeoutSeconds: 60,
  httpRouteTriggerSettings: { path: '/booking/api', httpMethod: 'POST', isAuthRequired: false, forwardedRequestHeaders: ['x-forwarded-for', 'x-real-ip', 'origin', 'user-agent'] },
  handler,
});
