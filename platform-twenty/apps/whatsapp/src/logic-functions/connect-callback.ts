import { defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { asApplication } from 'src/lib/api';
import { connectKey } from 'src/lib/connect';

type CallbackPayload = { httpMethod: 'GET' | 'POST'; body: Record<string, unknown> | null };

// Twenty stores what this returns: the key becomes the connection's encrypted token. An invalid key connects nothing.
const handler = async (payload: CallbackPayload) => {
  const key = typeof payload.body?.secretKey === 'string' ? payload.body.secretKey.trim() : '';
  if (payload.httpMethod !== 'POST' || !key) return null;
  try {
    return await asApplication(() => connectKey(key));
  } catch (error) {
    console.error(`whatsapp: InventiveChat key not connected: ${(error as Error).message}`);
    return null;
  }
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.connectCallback,
  name: 'whatsapp-connect-callback',
  description: 'Checks a pasted InventiveChat key, registers the webhook for new messages and keeps the account details.',
  timeoutSeconds: 30,
  handler,
});
