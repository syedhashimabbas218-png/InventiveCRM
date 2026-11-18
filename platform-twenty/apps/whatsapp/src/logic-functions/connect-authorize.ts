import { defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { functionsBaseUrl } from 'src/lib/settings';

type AuthorizePayload = { connectionProviderName: string; callbackUrl: string };

const handler = async (payload: AuthorizePayload) => {
  const url = new URL(`${await functionsBaseUrl()}/whatsapp/connect`);
  url.searchParams.set('callback', payload.callbackUrl);
  return { authorizationUrl: url.toString() };
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.connectAuthorize,
  name: 'whatsapp-connect-authorize',
  description: 'Starts connecting InventiveChat: sends the admin to the page where they paste the API key.',
  timeoutSeconds: 15,
  handler,
});
