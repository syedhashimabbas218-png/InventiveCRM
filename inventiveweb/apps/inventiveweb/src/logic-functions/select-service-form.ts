import { defineLogicFunction } from 'twenty-sdk/define';
import { type LogicFunctionExecutionContext, type RoutePayload } from 'twenty-sdk/logic-function';
import { selectServiceForm } from '../domain/form-publishing.ts';
import { createFormRepository } from '../infrastructure/twenty-form-repository.ts';
import { actionErrorResponse } from '../infrastructure/form-action-response.ts';

export const handler = async (event: RoutePayload, context: LogicFunctionExecutionContext) => {
  try { return await selectServiceForm(event.body, context, createFormRepository()); }
  catch (error) { return actionErrorResponse(error); }
};
export default defineLogicFunction({
  universalIdentifier: '6ac35d24-8e93-490a-9baf-01a771221e9a', name: 'inventiveweb-select-service-form',
  timeoutSeconds: 15, handler,
  httpRouteTriggerSettings: { path: '/inventiveweb/services/select-form', httpMethod: 'POST', isAuthRequired: true },
});
