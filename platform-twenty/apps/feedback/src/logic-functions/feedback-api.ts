import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { PublicError, submitAnswer, surveyInfo } from 'src/lib/answers';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const handler = async (event: RoutePayload<Record<string, unknown>>) => {
  const body = event.body ?? {};
  try {
    if (body.action === 'info') return json(200, await surveyInfo(String(body.token ?? '')));
    if (body.action === 'answer') return json(200, await submitAnswer(body));
    return json(400, { error: 'INVALID', message: 'Unknown action.' });
  } catch (error) {
    if (error instanceof PublicError) return json(error.status, { error: error.code, message: error.message });
    console.error(`feedback api: ${(error as Error).stack ?? error}`);
    return json(500, { error: 'ERROR', message: 'Something went wrong. Please try again.' });
  }
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.api,
  name: 'feedback-api',
  description: 'Public API behind the feedback page: survey details and the answer.',
  timeoutSeconds: 30,
  httpRouteTriggerSettings: { path: '/feedback/api', httpMethod: 'POST', isAuthRequired: false },
  handler,
});
