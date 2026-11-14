import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { asApplication } from 'src/lib/api';
import { handleWhatsAppStatus, verifyGatewaySignature } from 'src/lib/events';

const handler = async (event: RoutePayload<{ recipientId?: string; status?: string; error?: string }>) => {
  if (!verifyGatewaySignature(event.rawBody ?? '', event.headers['x-inventivecrm-timestamp'], event.headers['x-inventivecrm-signature'])) return new Response('', { status: 401 });
  const updated = await asApplication(() => handleWhatsAppStatus(event.body ?? {}));
  return new Response(JSON.stringify({ ok: updated }), { status: updated ? 200 : 400, headers: { 'content-type': 'application/json' } });
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.whatsappStatus,
  name: 'campaigns-whatsapp-status',
  description: 'Receives signed delivery, read, failure and opt-out updates for WhatsApp campaign messages.',
  timeoutSeconds: 15,
  httpRouteTriggerSettings: {
    path: '/campaigns/whatsapp/status',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-inventivecrm-timestamp', 'x-inventivecrm-signature'],
  },
  handler,
});
