import { createHmac, timingSafeEqual } from 'node:crypto';

import { type RecipientStatus } from 'src/constants/enums';
import { addSuppression, getCampaign, getRecipient, loadBrand, recipientByMessageId, type Recipient, updateRecipient, withdrawConsent } from 'src/lib/store';
import { parseRecipientToken, verifyRecipientToken } from 'src/lib/tokens';

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
  if (recipient.status !== 'UNSUBSCRIBED') await updateRecipient(recipient.id, { status: 'UNSUBSCRIBED', unsubscribedAt: new Date().toISOString() });
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

// Later events never move a recipient back: a delivered email that is later opened stays delivered, and a bounce
// or complaint is final.
const FINAL: RecipientStatus[] = ['BOUNCED', 'COMPLAINED', 'UNSUBSCRIBED', 'FAILED'];

export const handleResendEvent = async (event: ResendEvent) => {
  const messageId = event.data?.email_id;
  if (!event.type || !messageId) return { ignored: 'not an email event' };
  const recipientId = tagValue(event.data?.tags, 'recipient');
  let recipient: Recipient | null = recipientId && /^[0-9a-f-]{36}$/.test(recipientId) ? await getRecipient(recipientId) : null;
  if (recipient && recipient.providerMessageId && recipient.providerMessageId !== messageId) recipient = null;
  recipient ??= await recipientByMessageId(messageId);
  if (!recipient) return { ignored: 'not a campaign email' };

  const at = event.created_at && !Number.isNaN(Date.parse(event.created_at)) ? new Date(event.created_at).toISOString() : new Date().toISOString();
  const final = FINAL.includes(recipient.status);
  switch (event.type) {
    case 'email.delivered':
      await updateRecipient(recipient.id, { deliveredAt: at, ...(final ? {} : { status: 'DELIVERED' }) });
      break;
    case 'email.opened':
      await updateRecipient(recipient.id, { openedAt: at });
      break;
    case 'email.clicked':
      await updateRecipient(recipient.id, { clickedAt: at, openedAt: at });
      break;
    case 'email.bounced': {
      const permanent = event.data?.bounce?.type === 'Permanent';
      await updateRecipient(recipient.id, { bouncedAt: at, status: 'BOUNCED', error: (event.data?.bounce?.message ?? 'The email bounced.').slice(0, 300) });
      if (permanent) await addSuppression(recipient.address, 'EMAIL', 'BOUNCED', recipient.campaignId, event.data?.bounce?.subType ?? '');
      break;
    }
    case 'email.complained':
      await updateRecipient(recipient.id, { complainedAt: at, status: 'COMPLAINED' });
      await addSuppression(recipient.address, 'EMAIL', 'COMPLAINED', recipient.campaignId);
      if (recipient.personId) await withdrawConsent(recipient.personId, 'EMAIL');
      break;
    case 'email.failed':
    case 'email.suppressed':
      if (!final) await updateRecipient(recipient.id, { status: 'FAILED', error: event.type === 'email.suppressed' ? 'Resend did not send it: the address is on your Resend suppression list.' : (event.data?.failed?.reason ?? 'Resend could not send it.').slice(0, 300) });
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
  if (kind === 'deliveredAt') await updateRecipient(recipient.id, { deliveredAt: now, ...(FINAL.includes(recipient.status) ? {} : { status: 'DELIVERED' }) });
  else if (kind === 'openedAt') await updateRecipient(recipient.id, { openedAt: now });
  else if (kind === 'failed') await updateRecipient(recipient.id, { status: 'FAILED', error: (body.error || 'WhatsApp could not deliver it.').slice(0, 300) });
  else {
    await addSuppression(recipient.address, 'WHATSAPP', 'UNSUBSCRIBED', recipient.campaignId);
    if (recipient.personId) await withdrawConsent(recipient.personId, 'WHATSAPP');
    await updateRecipient(recipient.id, { status: 'UNSUBSCRIBED', unsubscribedAt: now });
  }
  return true;
};
