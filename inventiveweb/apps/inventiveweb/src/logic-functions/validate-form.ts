import { defineLogicFunction } from 'twenty-sdk/define';
import { Response, type RoutePayload } from 'twenty-sdk/logic-function';
import { parseFormSchema, validateAnswers } from '../shared/forms';
export const handler = async (event: RoutePayload) => {
  try {
    const body = event.body as { schema?: unknown; answers?: unknown } | null;
    const schema = parseFormSchema(body?.schema);
    return { schema, validation: validateAnswers(schema, body?.answers ?? {}, 'customer') };
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid form' }),
      { status: 400, headers: { 'content-type': 'application/json' } });
  }
};
export default defineLogicFunction({
  universalIdentifier: 'c6f1f682-bc77-53f5-a7e8-c2721f4916e9',
  name: 'inventiveweb-validate-form', timeoutSeconds: 5, handler,
  httpRouteTriggerSettings: { path: '/inventiveweb/forms/validate', httpMethod: 'POST', isAuthRequired: true },
});
