import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { recordSystemError } from 'src/lib/lifecycle';
import { AdminError, handleAdmin } from 'src/lib/admin';
import { BookingError } from 'src/lib/booking';

const handler = async (event: RoutePayload<Record<string, unknown>>) => {
  try {
    return new Response(JSON.stringify(await handleAdmin(event.body ?? {})), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch (error) {
    const status = error instanceof AdminError ? error.status : error instanceof BookingError ? (error.code === 'SLOT_TAKEN' ? 409 : 400) : 500;
    if (status === 500) await recordSystemError('scheduling-admin', error);
    if (status === 500) console.error(`scheduling admin: ${(error as Error).stack ?? error}`);
    const message = status === 500 ? 'Something went wrong. It has been recorded; please try again.' : (error as Error).message;
    return new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } });
  }
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.schedulingAdmin,
  name: 'scheduling-admin',
  description: 'Data for the Scheduling pages: overview, calendar connections, advisor setup and manual booking.',
  timeoutSeconds: 120,
  httpRouteTriggerSettings: { path: '/scheduling/admin', httpMethod: 'POST', isAuthRequired: true },
  handler,
});
