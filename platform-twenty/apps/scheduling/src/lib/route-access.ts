import { Response } from 'twenty-sdk/logic-function';

import { isSignedInPerson } from 'src/lib/api';

export const notSignedInResponse = () =>
  new Response(JSON.stringify({ error: 'Only people signed in to this workspace can do this.' }), { status: 403, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

// For functions that are also cron jobs: only route calls carry a request context, and cron runs act as the app by design.
export const refuseUnlessSignedIn = (event: object | null | undefined) =>
  event && 'requestContext' in event && !isSignedInPerson(event as { userWorkspaceId?: string | null }) ? notSignedInResponse() : null;
