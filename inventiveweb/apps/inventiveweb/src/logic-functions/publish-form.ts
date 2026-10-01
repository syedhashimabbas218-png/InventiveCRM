import { defineLogicFunction } from 'twenty-sdk/define';
import { type LogicFunctionExecutionContext, type RoutePayload } from 'twenty-sdk/logic-function';
import { publishForm } from '../domain/form-publishing.ts';
import { createFormRepository } from '../infrastructure/twenty-form-repository.ts';
import { actionErrorResponse } from '../infrastructure/form-action-response.ts';

export const handler = async (event: RoutePayload, context: LogicFunctionExecutionContext) => {
  try { return await publishForm(event.body, context, createFormRepository()); }
  catch (error) { return actionErrorResponse(error); }
};
export default defineLogicFunction({
  universalIdentifier: '3268036d-aad1-4a17-9f5f-a6ca02d57158', name: 'inventiveweb-publish-form',
  timeoutSeconds: 20, handler,
  httpRouteTriggerSettings: { path: '/inventiveweb/forms/publish', httpMethod: 'POST', isAuthRequired: true },
});
