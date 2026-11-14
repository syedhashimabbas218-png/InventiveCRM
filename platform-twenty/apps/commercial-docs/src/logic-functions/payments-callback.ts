import { defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { providerFromConnectionName } from 'src/lib/payment-connect';
import { validatePaymentKey } from 'src/lib/payments';

type CallbackPayload = { connectionProviderName: string; httpMethod: 'GET' | 'POST'; body: Record<string, unknown> | null };

// Twenty stores what this returns: the key becomes the connection's encrypted token. An invalid key connects nothing.
const handler = async (payload: CallbackPayload) => {
  const provider = providerFromConnectionName(payload.connectionProviderName);
  const key = typeof payload.body?.secretKey === 'string' ? payload.body.secretKey.trim() : '';
  if (!provider || payload.httpMethod !== 'POST' || !key) return null;
  try {
    const { mode, fingerprint } = await validatePaymentKey(provider, key);
    return {
      externalAccountId: `${provider.toLowerCase()}-${fingerprint}`,
      handle: `${provider === 'STRIPE' ? 'Stripe' : 'Revolut'} ${mode === 'test' ? 'test ' : ''}key ending ${key.slice(-4)}`,
      accessToken: key,
    };
  } catch (error) {
    console.error(`payment key rejected: ${(error as Error).message}`);
    return null;
  }
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.paymentsCallback,
  name: 'payments-callback',
  description: 'Checks a pasted Stripe or Revolut key with the provider before Twenty stores it.',
  timeoutSeconds: 30,
  handler,
});
