import { defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { functionsBaseUrl } from 'src/lib/delivery';
import { providerFromConnectionName } from 'src/lib/payment-connect';

type AuthorizePayload = { connectionProviderName: string; callbackUrl: string };

const handler = async (payload: AuthorizePayload) => {
  const provider = providerFromConnectionName(payload.connectionProviderName);
  if (!provider) throw new Error('Unknown payment provider.');
  const url = new URL(`${await functionsBaseUrl()}/payments/connect`);
  url.searchParams.set('provider', provider);
  url.searchParams.set('callback', payload.callbackUrl);
  return { authorizationUrl: url.toString() };
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.paymentsAuthorize,
  name: 'payments-authorize',
  description: 'Starts connecting a Stripe or Revolut account: sends the user to the page where they paste their key.',
  timeoutSeconds: 15,
  handler,
});
