import { type MessageStatus } from 'src/constants/enums';
import { signBody } from 'src/lib/crypto';
import { type MessageRow } from 'src/lib/records';
import { isOwnCallbackUrl } from 'src/lib/settings';

export const CAMPAIGN_EVENT = 'campaign.message';
export const CAMPAIGN_KEY_PREFIX = 'campaign:';

const FORWARD_TIMEOUT_MS = 3000;

// The shapes WHATSAPP_HANDOFF.md promises the other apps: documents get every status, campaigns no "sent".
export const callbackBody = (message: Pick<MessageRow, 'deliveryId' | 'gatewayEvent' | 'inventiveChatMessageId' | 'error'>, status: MessageStatus | 'OPTED_OUT') => {
  if (!message.deliveryId || status === 'QUEUED') return null;
  const lower = status.toLowerCase();
  const error = status === 'FAILED' ? { error: message.error || 'WhatsApp could not deliver the message.' } : {};
  if (message.gatewayEvent === CAMPAIGN_EVENT) {
    if (status === 'SENT' || !message.deliveryId.startsWith(CAMPAIGN_KEY_PREFIX)) return null;
    return { recipientId: message.deliveryId.slice(CAMPAIGN_KEY_PREFIX.length), status: lower, ...error };
  }
  if (status === 'OPTED_OUT') return null;
  return { deliveryId: message.deliveryId, ...(message.inventiveChatMessageId ? { messageId: message.inventiveChatMessageId } : {}), status: lower, ...error };
};

// Receivers only move statuses forward, so sending one twice (a webhook retried after a failed forward) is harmless.
export const forwardStatus = async (message: MessageRow, status: MessageStatus | 'OPTED_OUT', origins: string[]) => {
  const payload = callbackBody(message, status);
  if (!payload || !message.statusCallbackUrl) return 'skipped';
  if (!isOwnCallbackUrl(message.statusCallbackUrl, origins)) {
    console.error(`whatsapp: status callback to another host refused for message ${message.id}`);
    return 'refused';
  }
  const secret = process.env.WHATSAPP_GATEWAY_SECRET;
  if (!secret) throw new Error('WHATSAPP_GATEWAY_SECRET is not set, so delivery updates cannot be sent back.');
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const response = await fetch(message.statusCallbackUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-InventiveCRM-Timestamp': timestamp, 'X-InventiveCRM-Signature': signBody(secret, timestamp, body) },
    body,
    signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
  });
  // A 4xx means the receiver will never take it (unknown delivery); only a 5xx is worth InventiveChat retrying.
  if (response.status >= 500) throw new Error(`the status callback answered ${response.status}`);
  if (!response.ok) console.error(`whatsapp: status callback for message ${message.id} answered ${response.status}`);
  return response.ok ? 'sent' : 'rejected';
};
