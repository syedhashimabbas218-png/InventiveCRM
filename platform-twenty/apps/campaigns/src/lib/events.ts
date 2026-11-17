import { createHmac, timingSafeEqual } from 'node:crypto';

import { type RecipientStatus } from 'src/constants/enums';
import { addSuppression, getCampaign, getRecipient, loadBrand, recipientByMessageId, type Recipient, updateRecipient, updateRecipientsIf, withdrawConsent } from 'src/lib/store';
import { parseRecipientToken, verifyRecipientToken } from 'src/lib/tokens';

// The statuses each event may move a recipient from: a bounce, complaint, unsubscribe or failure is never undone, and
// a failure report never overrides a delivery. The event's timestamp is recorded either way.
export const MOVES_FROM: Record<'DELIVERED' | 'BOUNCED' | 'COMPLAINED' | 'UNSUBSCRIBED' | 'FAILED', RecipientStatus[]> = {
  DELIVERED: ['SENDING', 'SENT'],
  BOUNCED: ['SENDING', 'SENT', 'DELIVERED'],
  COMPLAINED: ['SENDING', 'SENT', 'DELIVERED'],
  UNSUBSCRIBED: ['SENDING', 'SENT', 'DELIVERED'],
  FAILED: ['SENDING', 'SENT'],
};

// One filtered update rather than read-then-write, so events arriving together cannot overwrite each other's status.
const moveStatus = async (recipientId: string, status: keyof typeof MOVES_FROM, timestamps: Record<string, string>, details: Record<string, unknown> = {}) => {
  const moved = await updateRecipientsIf({ ids: [recipientId], status: MOVES_FROM[status] }, { status, ...timestamps, ...details });
  if (moved === 0 && Object.keys(timestamps).length > 0) await updateRecipient(recipientId, timestamps);
};

const recipientFromToken = async (token: string) => {
  const parsed = parseRecipientToken(token);
  if (!parsed) return null;
  const recipient = await getRecipient(parsed.recipientId);
  return recipient && verifyRecipientToken(token, recipient.nonce) ? recipient : null;
};

export const unsubscribeInfo = async (token: string) => {
  const recipient = await recipientFromToken(token);
  if (!recipient) return null;
  const brand = await loadBrand();
  return { businessName: brand.name || 'this sender', alreadyDone: recipient.status === 'UNSUBSCRIBED', primaryColor: brand.primaryColor };
};

// Used by the page button and by mail providers' one-click unsubscribe (RFC 8058); calling it twice is harmless.
export const unsubscribe = async (token: string) => {
  const recipient = await recipientFromToken(token);
  if (!recipient) return false;
  const campaign = await getCampaign(recipient.campaignId);
  const channel = campaign?.channel ?? 'EMAIL';
  await addSuppression(recipient.address, channel, 'UNSUBSCRIBED', recipient.campaignId);
  if (recipient.personId) await withdrawConsent(recipient.personId, channel);
  if (recipient.status !== 'UNSUBSCRIBED') await moveStatus(recipient.id, 'UNSUBSCRIBED', { unsubscribedAt: new Date().toISOString() });
  return true;
};

type ResendEvent = {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    tags?: Record<string, string> | { name: string; value: string }[];
    bounce?: { type?: string; subType?: string; message?: string };
    failed?: { reason?: string };
  };
};

const tagValue = (tags: NonNullable<ResendEvent['data']>['tags'], name: string) => {
  if (Array.isArray(tags)) return tags.find((tag) => tag.name === name)?.value;
  return tags?.[name];
};

export const handleResendEvent = async (event: ResendEvent) => {
  const messageId = event.data?.email_id;
  if (!event.type || !messageId) return { ignored: 'not an email event' };
  const recipientId = tagValue(event.data?.tags, 'recipient');
  let recipient: Recipient | null = recipientId && /^[0-9a-f-]{36}$/.test(recipientId) ? await getRecipient(recipientId) : null;
  if (recipient && recipient.providerMessageId && recipient.providerMessageId !== messageId) recipient = null;
  recipient ??= await recipientByMessageId(messageId);
  if (!recipient) return { ignored: 'not a campaign email' };

  const at = event.created_at && !Number.isNaN(Date.parse(event.created_at)) ? new Date(event.created_at).toISOString() : new Date().toISOString();
  switch (event.type) {
    case 'email.delivered':
      await moveStatus(recipient.id, 'DELIVERED', { deliveredAt: at });
      break;
    case 'email.opened':
      await updateRecipient(recipient.id, { openedAt: at });
      break;
    case 'email.clicked':
      await updateRecipient(recipient.id, { clickedAt: at, openedAt: at });
      break;
    case 'email.bounced': {
      const permanent = event.data?.bounce?.type === 'Permanent';
      await moveStatus(recipient.id, 'BOUNCED', { bouncedAt: at }, { error: (event.data?.bounce?.message ?? 'The email bounced.').slice(0, 300) });
      if (permanent) await addSuppression(recipient.address, 'EMAIL', 'BOUNCED', recipient.campaignId, event.data?.bounce?.subType ?? '');
      break;
    }
    case 'email.complained':
      await moveStatus(recipient.id, 'COMPLAINED', { complainedAt: at });
      await addSuppression(recipient.address, 'EMAIL', 'COMPLAINED', recipient.campaignId);
      if (recipient.personId) await withdrawConsent(recipient.personId, 'EMAIL');
      break;
    case 'email.failed':
    case 'email.suppressed':
      await moveStatus(recipient.id, 'FAILED', {}, { error: event.type === 'email.suppressed' ? 'Resend did not send it: the address is on your Resend suppression list.' : (event.data?.failed?.reason ?? 'Resend could not send it.').slice(0, 300) });
      break;
    default:
      return { ignored: event.type };
  }
  return { updated: recipient.id };
};

export const verifyGatewaySignature = (rawBody: string, timestamp: string | undefined, signature: string | undefined) => {
  const secret = process.env.WHATSAPP_GATEWAY_SECRET;
  if (!secret || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
};

const WHATSAPP_STATUSES: Record<string, 'deliveredAt' | 'openedAt' | 'failed' | 'optOut'> = { delivered: 'deliveredAt', read: 'openedAt', failed: 'failed', opted_out: 'optOut' };

export const handleWhatsAppStatus = async (body: { recipientId?: string; status?: string; error?: string }) => {
  const kind = body.status ? WHATSAPP_STATUSES[body.status.toLowerCase()] : undefined;
  if (!body.recipientId || !/^[0-9a-f-]{36}$/.test(body.recipientId) || !kind) return false;
  const recipient = await getRecipient(body.recipientId);
  if (!recipient) return false;
  const now = new Date().toISOString();
  if (kind === 'deliveredAt') await moveStatus(recipient.id, 'DELIVERED', { deliveredAt: now });
  else if (kind === 'openedAt') await updateRecipient(recipient.id, { openedAt: now });
  else if (kind === 'failed') await moveStatus(recipient.id, 'FAILED', {}, { error: (body.error || 'WhatsApp could not deliver it.').slice(0, 300) });
  else {
    await addSuppression(recipient.address, 'WHATSAPP', 'UNSUBSCRIBED', recipient.campaignId);
    if (recipient.personId) await withdrawConsent(recipient.personId, 'WHATSAPP');
    await moveStatus(recipient.id, 'UNSUBSCRIBED', { unsubscribedAt: now });
  }
  return true;
};
