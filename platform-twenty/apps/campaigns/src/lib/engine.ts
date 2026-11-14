import { createHmac } from 'node:crypto';

import { metadata } from 'src/lib/api';
import { designProblems, renderEmail, type Brand, type Contact } from 'src/lib/design';
import { BATCH_SIZE, listDomains, ResendError, resendKey, sendBatch, sendOne, type OutgoingEmail } from 'src/lib/resend';
import {
  ALL_CONSENTED,
  audiencePeople,
  type Campaign,
  campaignsWithStatus,
  contactOf,
  createRecipients,
  getMailingList,
  loadBrand,
  normaliseAddress,
  type Person,
  queuedRecipients,
  recentlySent,
  type Recipient,
  recountCampaign,
  suppressedAddresses,
  updateCampaign,
  updateRecipients,
} from 'src/lib/store';
import { newNonce, recipientToken } from 'src/lib/tokens';

export class CampaignError extends Error {}

export const functionsBaseUrl = async () => {
  if (process.env.TWENTY_FUNCTIONS_URL) return process.env.TWENTY_FUNCTIONS_URL.replace(/\/$/, '');
  const { currentWorkspace } = await metadata<{ currentWorkspace: { workspaceUrls: { customUrl: string | null; subdomainUrl: string } } }>(`{ currentWorkspace { workspaceUrls { customUrl subdomainUrl } } }`);
  return `${(currentWorkspace.workspaceUrls.customUrl || currentWorkspace.workspaceUrls.subdomainUrl).replace(/\/$/, '')}/s`;
};

export const unsubscribeUrl = (base: string, recipient: Pick<Recipient, 'id' | 'nonce'>) => `${base}/campaigns/unsubscribe/${recipientToken(recipient.id, recipient.nonce)}`;

const EMAIL_PATTERN = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;

export const isEmail = (value: string) => value.length <= 254 && EMAIL_PATTERN.test(value);

export const fromAddress = (campaign: Pick<Campaign, 'fromName' | 'fromLocalPart' | 'fromDomain'>) => {
  const name = campaign.fromName.replace(/["<>\r\n]/g, '').trim();
  const address = `${campaign.fromLocalPart.trim().toLowerCase()}@${campaign.fromDomain.trim().toLowerCase()}`;
  return name ? `"${name}" <${address}>` : address;
};

// Everything that must be true before a campaign may leave; the studio shows the same list before scheduling.
export const campaignProblems = async (campaign: Campaign, brand: Brand) => {
  const problems: string[] = [];
  if (!campaign.listId) problems.push('Choose who to send it to.');
  if (campaign.channel === 'EMAIL') {
    if (!campaign.subject.trim()) problems.push('Add a subject line.');
    if (!/^[a-z0-9._+-]{1,64}$/i.test(campaign.fromLocalPart.trim())) problems.push('Choose a sending address.');
    if (campaign.replyTo && !isEmail(campaign.replyTo.trim())) problems.push('The reply-to address is not a valid email address.');
    problems.push(...designProblems(campaign.design, brand));
    const key = await resendKey();
    if (!key) problems.push('Connect your Resend account under Settings, Accounts.');
    else {
      const domains = await listDomains(key).catch(() => null);
      if (!domains) problems.push('Resend could not be reached to check your sending domain. Try again in a minute.');
      else if (!campaign.fromDomain.trim()) problems.push('Choose the domain to send from.');
      else if (!domains.some((domain) => domain.name === campaign.fromDomain.trim().toLowerCase() && domain.status === 'verified'))
        problems.push(`The domain ${campaign.fromDomain} is not verified in your Resend account.`);
    }
  } else {
    if (!/^[a-z0-9_]{1,512}$/.test(campaign.whatsappTemplate)) problems.push('Choose an approved WhatsApp template (its name, in lower case).');
    if (!process.env.WHATSAPP_GATEWAY_URL || !process.env.WHATSAPP_GATEWAY_SECRET) problems.push('WhatsApp sending is not set up on this server yet.');
  }
  return problems;
};

const phoneOf = (person: Person) => {
  const number = (person.phones?.primaryPhoneNumber ?? '').replace(/[^0-9]/g, '');
  if (!number) return '';
  const code = (person.phones?.primaryPhoneCallingCode ?? '').replace(/[^0-9]/g, '');
  return `+${code}${number.replace(/^0+/, '')}`;
};

// Turns the audience into recipient records: only people who agreed, with a usable address, not on the
// do-not-contact list, each address once.
export const prepareRecipients = async (campaign: Campaign) => {
  if (campaign.listId !== ALL_CONSENTED && !(await getMailingList(campaign.listId))) throw new CampaignError('The mailing list no longer exists.');
  const people = await audiencePeople(campaign.listId, campaign.channel);
  const suppressed = await suppressedAddresses(campaign.channel);
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const person of people) {
    const consent = campaign.channel === 'EMAIL' ? person.emailMarketingConsent : person.whatsappMarketingConsent;
    const raw = campaign.channel === 'EMAIL' ? (person.emails?.primaryEmail ?? '').trim() : phoneOf(person);
    const address = raw ? normaliseAddress(raw, campaign.channel) : '';
    const usable = campaign.channel === 'EMAIL' ? isEmail(address) : /^\+[1-9][0-9]{7,14}$/.test(address);
    if (!consent || !usable || suppressed.has(address) || seen.has(address)) {
      skipped += 1;
      continue;
    }
    seen.add(address);
    const name = [person.name?.firstName, person.name?.lastName].filter(Boolean).join(' ') || address;
    rows.push({ name: name.slice(0, 200), destination: address, status: 'QUEUED', nonce: newNonce(), campaignId: campaign.id, personId: person.id });
  }
  await createRecipients(rows);
  return { recipients: rows.length, skipped };
};

const emailFor = (campaign: Campaign, brand: Brand, recipient: Recipient, base: string): OutgoingEmail => {
  const contact: Contact = { ...contactOf(recipient.person ? { ...recipient.person, emails: { primaryEmail: recipient.address } } : null), email: recipient.address };
  const unsubscribe = unsubscribeUrl(base, recipient);
  const rendered = renderEmail(campaign.design, brand, { subject: campaign.subject, previewText: campaign.previewText, unsubscribeUrl: unsubscribe, contact });
  return {
    from: fromAddress(campaign),
    to: [recipient.address],
    subject: rendered.subject.slice(0, 250),
    html: rendered.html,
    text: rendered.text,
    ...(campaign.replyTo.trim() ? { reply_to: campaign.replyTo.trim() } : {}),
    headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    tags: [
      { name: 'campaign', value: campaign.id },
      { name: 'recipient', value: recipient.id },
    ],
  };
};

const sendEmailBatch = async (campaign: Campaign, brand: Brand, key: string, recipients: Recipient[], base: string) => {
  const emails = recipients.map((recipient) => emailFor(campaign, brand, recipient, base));
  const now = new Date().toISOString();
  try {
    const ids = await sendBatch(key, emails, `campaign-${campaign.id}-${recipients[0].id}-${recipients.length}`);
    await updateRecipients(recipients.map((recipient, index) => ({ id: recipient.id, data: ids[index] ? { status: 'SENT', providerMessageId: ids[index], sentAt: now } : { status: 'FAILED', error: 'Resend did not accept this message.' } })));
  } catch (error) {
    // A batch is refused as a whole when one message is invalid, so send that batch one by one to find it.
    if (!(error instanceof ResendError) || (error.status !== 400 && error.status !== 422)) throw error;
    const updates = [];
    for (const [index, email] of emails.entries()) {
      try {
        const id = await sendOne(key, email, `campaign-${campaign.id}-${recipients[index].id}`);
        updates.push({ id: recipients[index].id, data: { status: 'SENT', providerMessageId: id, sentAt: now } });
      } catch (single) {
        if (single instanceof ResendError && (single.status === 400 || single.status === 422)) updates.push({ id: recipients[index].id, data: { status: 'FAILED', error: single.message.slice(0, 300) } });
        else {
          await updateRecipients(updates);
          throw single;
        }
      }
    }
    await updateRecipients(updates);
  }
};

// Hands one batch to InventiveChat, which owns the WhatsApp number, templates and the Meta connection.
const sendWhatsAppBatch = async (campaign: Campaign, recipients: Recipient[], base: string) => {
  const { WHATSAPP_GATEWAY_URL, WHATSAPP_GATEWAY_SECRET } = process.env;
  if (!WHATSAPP_GATEWAY_URL || !WHATSAPP_GATEWAY_SECRET) throw new CampaignError('WhatsApp sending is not set up on this server yet.');
  const body = JSON.stringify({
    event: 'campaign.message',
    campaignId: campaign.id,
    template: { name: campaign.whatsappTemplate, language: campaign.whatsappVariables.language || 'en' },
    messages: recipients.map((recipient) => {
      const contact = contactOf(recipient.person ? { ...recipient.person, emails: null } : null);
      return {
        recipientId: recipient.id,
        to: recipient.address,
        variables: Object.entries(campaign.whatsappVariables)
          .filter(([name]) => /^\d+$/.test(name))
          .sort(([left], [right]) => Number(left) - Number(right))
          .map(([, value]) => value.replace(/\{\{\s*firstName\s*\}\}/g, contact.firstName || 'there').replace(/\{\{\s*lastName\s*\}\}/g, contact.lastName ?? '')),
        optOutUrl: unsubscribeUrl(base, recipient),
      };
    }),
    statusCallbackUrl: `${base}/campaigns/whatsapp/status`,
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', WHATSAPP_GATEWAY_SECRET).update(`${timestamp}.${body}`).digest('hex');
  const response = await fetch(WHATSAPP_GATEWAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-InventiveCRM-Timestamp': timestamp, 'X-InventiveCRM-Signature': `sha256=${signature}` },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const reply = (await response.json().catch(() => ({}))) as { accepted?: { recipientId: string; messageId?: string }[]; error?: string };
  if (!response.ok) throw new CampaignError(`The WhatsApp service answered ${response.status}${reply.error ? `: ${reply.error}` : ''}`);
  const accepted = new Map((reply.accepted ?? []).map((entry) => [entry.recipientId, entry.messageId ?? '']));
  const now = new Date().toISOString();
  await updateRecipients(
    recipients.map((recipient) => ({ id: recipient.id, data: accepted.has(recipient.id) ? { status: 'SENT', providerMessageId: accepted.get(recipient.id) || null, sentAt: now } : { status: 'FAILED', error: 'The WhatsApp service did not accept this message.' } })),
  );
};

const RUN_BUDGET_MS = 80_000;
const MAX_BATCHES_PER_RUN = 40;

const failCampaign = (campaign: Campaign, message: string) => updateCampaign(campaign.id, { status: 'FAILED', lastError: message.slice(0, 500) });

export const runCampaigns = async (now = Date.now()) => {
  const started = Date.now();
  const outcome = { prepared: 0, batches: 0, finished: 0, paused: [] as string[] };
  const base = await functionsBaseUrl();
  const brand = await loadBrand();
  let key: string | null | undefined;

  for (const campaign of await campaignsWithStatus(['SCHEDULED'])) {
    if (!campaign.scheduledAt || new Date(campaign.scheduledAt).getTime() > now) continue;
    const problems = await campaignProblems(campaign, brand);
    if (problems.length) {
      await failCampaign(campaign, problems.join(' '));
      continue;
    }
    // Claim it first, so a second run never prepares the same campaign twice.
    await updateCampaign(campaign.id, { status: 'SENDING', startedAt: new Date().toISOString(), lastError: '' });
    try {
      const { recipients, skipped } = await prepareRecipients(campaign);
      await updateCampaign(campaign.id, { recipientCount: recipients, skippedCount: skipped });
      outcome.prepared += 1;
    } catch (error) {
      await failCampaign(campaign, (error as Error).message);
    }
  }

  for (const campaign of await campaignsWithStatus(['SENDING'])) {
    if (campaign.channel === 'EMAIL' && key === undefined) key = await resendKey();
    try {
      while (outcome.batches < MAX_BATCHES_PER_RUN && Date.now() - started < RUN_BUDGET_MS) {
        const batch = await queuedRecipients(campaign.id, BATCH_SIZE);
        if (batch.length === 0) {
          await recountCampaign(campaign.id);
          await updateCampaign(campaign.id, { status: 'SENT', sentAt: new Date().toISOString(), lastError: '' });
          outcome.finished += 1;
          break;
        }
        if (campaign.channel === 'EMAIL') {
          if (!key) throw new CampaignError('The Resend account was disconnected. Connect it again and resume the campaign.');
          await sendEmailBatch(campaign, brand, key, batch, base);
        } else await sendWhatsAppBatch(campaign, batch, base);
        outcome.batches += 1;
      }
    } catch (error) {
      // Rate limits, quotas and outages pause the campaign until the next run (idempotency keys make the retry
      // safe); anything else stops it.
      const transient = error instanceof ResendError ? error.status === 429 || error.status >= 500 : ['TypeError', 'TimeoutError', 'AbortError'].includes((error as Error).name);
      if (transient) {
        const message =
          error instanceof ResendError && (error.code === 'daily_quota_exceeded' || error.code === 'monthly_quota_exceeded')
            ? 'Your Resend plan limit is reached. Sending continues automatically when it resets.'
            : error instanceof ResendError && error.status === 429
              ? 'Resend asked us to slow down. Sending continues shortly.'
              : 'The sending service could not be reached. Sending is retried every two minutes.';
        await updateCampaign(campaign.id, { lastError: message });
        outcome.paused.push(campaign.id);
        break;
      }
      await failCampaign(campaign, (error as Error).message);
    }
    if (Date.now() - started >= RUN_BUDGET_MS || outcome.batches >= MAX_BATCHES_PER_RUN) break;
  }

  for (const campaign of await recentlySent(new Date(now - 14 * 86_400_000).toISOString())) await recountCampaign(campaign.id);
  for (const campaign of await campaignsWithStatus(['SENDING'])) await recountCampaign(campaign.id);
  return outcome;
};
