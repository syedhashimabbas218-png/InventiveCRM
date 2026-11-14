import { defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { functionsBaseUrl } from 'src/lib/engine';

type AuthorizePayload = { connectionProviderName: string; callbackUrl: string };

const handler = async (payload: AuthorizePayload) => {
  const url = new URL(`${await functionsBaseUrl()}/campaigns/connect`);
  url.searchParams.set('callback', payload.callbackUrl);
  return { authorizationUrl: url.toString() };
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.connectAuthorize,
  name: 'resend-authorize',
  description: 'Starts connecting a Resend account: sends the user to the page where they paste their API key.',
  timeoutSeconds: 15,
  handler,
});
