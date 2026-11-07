import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { publicBaseUrl } from 'src/lib/notify';
import { bookingPage } from 'src/lib/page';

const handler = async (event: RoutePayload) =>
  new Response(bookingPage({ base: await publicBaseUrl(), slug: (event.pathParameters.slug ?? '').slice(0, 120), token: '', mode: 'book' }), {
    status: 200,
    // The page is a shell that loads its data from the booking API, so it is the same for every visitor.
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=300' },
  });

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.bookPage,
  name: 'book-page',
  description: 'Public booking page for an appointment type, booking link or advisor.',
  timeoutSeconds: 15,
  httpRouteTriggerSettings: { path: '/book/:slug', httpMethod: 'GET', isAuthRequired: false },
  handler,
});
