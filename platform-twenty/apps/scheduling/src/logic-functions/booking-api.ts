import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { recordSystemError } from 'src/lib/lifecycle';
import { errorResponse, handlePublicApi } from 'src/lib/public-api';

// Public read answers are the same for every visitor, so the proxy may share them briefly (browsers never keep them).
// A booking always re-checks availability live, so a cached slot list can never cause a double booking.
const SHARED_SECONDS: Record<string, number> = { page: 60, slots: 30, advisors: 30, geocode: 3600 };

const cacheControl = (action: unknown) => {
  const seconds = typeof action === 'string' ? SHARED_SECONDS[action] : undefined;
  return seconds ? `public, max-age=0, s-maxage=${seconds}` : 'no-store';
};

const handler = async (event: RoutePayload<Record<string, unknown>>) => {
  try {
    const result = await handlePublicApi(event.body ?? {}, event.headers);
    return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': cacheControl(event.body?.action) } });
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
