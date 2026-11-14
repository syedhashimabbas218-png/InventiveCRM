import { defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { functionsBaseUrl } from 'src/lib/engine';
import { ensureWebhook, validateKey } from 'src/lib/resend';
import { webhookToken } from 'src/lib/tokens';

type CallbackPayload = { httpMethod: 'GET' | 'POST'; body: Record<string, unknown> | null };

// Twenty stores what this returns: the key becomes the connection's encrypted token. An invalid key connects nothing.
const handler = async (payload: CallbackPayload) => {
  const key = typeof payload.body?.secretKey === 'string' ? payload.body.secretKey.trim() : '';
  if (payload.httpMethod !== 'POST' || !key) return null;
  try {
    const { fingerprint, domains } = await validateKey(key);
    const webhook = `${await functionsBaseUrl()}/campaigns/webhook/${webhookToken()}`;
    if (webhook.startsWith('https://')) await ensureWebhook(key, webhook).catch((error: Error) => console.error(`resend webhook setup: ${error.message}`));
    const verified = domains.filter((domain) => domain.status === 'verified').map((domain) => domain.name);
    return { externalAccountId: `resend-${fingerprint}`, handle: `Resend key ending ${key.slice(-4)}${verified.length ? ` (${verified.slice(0, 3).join(', ')})` : ''}`.slice(0, 200), accessToken: key };
  } catch (error) {
    console.error(`resend key rejected: ${(error as Error).message}`);
    return null;
  }
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.connectCallback,
  name: 'resend-callback',
  description: 'Checks a pasted Resend API key before Twenty stores it, and registers the delivery-tracking webhook.',
  timeoutSeconds: 30,
  handler,
});
