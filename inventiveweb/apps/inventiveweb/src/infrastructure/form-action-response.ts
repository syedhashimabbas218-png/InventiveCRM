import { RestApiClientError } from 'twenty-client-sdk/rest';
import { Response } from 'twenty-sdk/logic-function';
import { FormActionError } from '../domain/form-publishing.ts';

export function actionErrorResponse(error: unknown) {
  const status = error instanceof FormActionError ? error.status
    : error instanceof RestApiClientError && [401, 403, 404].includes(error.status ?? 0) ? error.status! : 500;
  const message = error instanceof FormActionError ? error.message : status === 403
    ? 'Your role does not allow this action.' : status === 404 ? 'Record not found.'
    : 'The action could not complete. Reload and retry.';
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { 'content-type': 'application/json' },
  });
}
