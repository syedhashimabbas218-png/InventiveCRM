import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';

import { type DeliveryStatus } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { updateDelivery, verifyWhatsAppSignature } from 'src/lib/delivery';

type StatusCallback = { deliveryId?: string; status?: string; messageId?: string; error?: string };

const STATUS_MAP: Record<string, DeliveryStatus> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};

const handler = async (event: RoutePayload<StatusCallback>) => {
  if (!verifyWhatsAppSignature(event.rawBody ?? '', event.headers['x-inventivecrm-timestamp'], event.headers['x-inventivecrm-signature']))
    throw new Error('Invalid signature');
  const { deliveryId, status, messageId, error } = event.body ?? {};
  const mapped = status ? STATUS_MAP[status.toLowerCase()] : undefined;
  if (!deliveryId || !mapped) throw new Error('deliveryId and a status of sent, delivered, read or failed are required');
  await updateDelivery(deliveryId, mapped, {
    ...(messageId ? { providerMessageId: messageId } : {}),
    ...(mapped === 'FAILED' ? { errorMessage: error || 'The WhatsApp service reported a failure.' } : {}),
  });
  return { ok: true };
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.whatsappStatus,
  name: 'whatsapp-status',
  description: 'Receives signed delivery updates (sent, delivered, read, failed) from the WhatsApp service.',
  timeoutSeconds: 15,
  httpRouteTriggerSettings: {
    path: '/whatsapp/status',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-inventivecrm-timestamp', 'x-inventivecrm-signature'],
  },
  handler,
});
