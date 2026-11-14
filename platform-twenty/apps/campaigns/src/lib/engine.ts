import { createHmac, randomUUID } from 'node:crypto';

import { metadata } from 'src/lib/api';
import { designProblems, renderEmail, type Brand, type Contact } from 'src/lib/design';
import { BATCH_SIZE, listDomains, ResendError, resendKey, sendBatch, sendOne, type OutgoingEmail } from 'src/lib/resend';
import {
  acquireLease,
  ALL_CONSENTED,
  audiencePage,
  batchRecipients,
  type Campaign,
  campaignStatus,
  campaignsWithStatus,
  claimBatch,
  consentOf,
  contactOf,
  createRecipients,
  existingRecipients,
  getMailingList,
  inFlightRecipients,
  loadBrand,
  normaliseAddress,
  type Person,
  queuedRecipients,
  recentlySent,
  type Recipient,
  recountCampaign,
  releaseLease,
  suppressedAddresses,
  suppressedAmong,
  updateCampaign,
  updateCampaignIf,
  updateRecipients,
  updateRecipientsIf,
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

export const RESEND_UNREACHABLE = 'Resend could not be reached to check your sending domain. Try again in a minute.';

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
      if (!domains) problems.push(RESEND_UNREACHABLE);
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

// Twenty stores the number and its calling code apart; a number without a code cannot be dialled safely.
export const phoneOf = (phones: Person['phones']) => {
  const raw = (phones?.primaryPhoneNumber ?? '').trim();
  if (raw.startsWith('+')) return `+${raw.replace(/[^0-9]/g, '')}`;
  const number = raw.replace(/[^0-9]/g, '').replace(/^0+/, '');
  const code = (phones?.primaryPhoneCallingCode ?? '').replace(/[^0-9]/g, '');
  return number && code ? `+${code}${number}` : '';
};

export const STOPPED = 'Stopped before sending.';

const PAGE_BUDGET_MS = 15_000;

// Turns one page of the audience after another into recipient rows until the run's time is used up. Everyone gets a
// row, so the report can say why someone was skipped. Returns true once the whole audience is done.
const prepareSome = async (campaign: Campaign, timeLeft: () => number) => {
  if (campaign.listId !== ALL_CONSENTED && !(await getMailingList(campaign.listId))) throw new CampaignError('The mailing list no longer exists.');
  const suppressed = await suppressedAddresses(campaign.channel);
  let cursor = campaign.prepareCursor || null;
  while (timeLeft() > PAGE_BUDGET_MS) {
    if ((await campaignStatus(campaign.id)) !== 'PREPARING') return false;
    const page = await audiencePage(campaign.listId, campaign.channel, cursor);
    const candidates = page.people.map((person) => {
      const raw = campaign.channel === 'EMAIL' ? (person.emails?.primaryEmail ?? '').trim() : phoneOf(person.phones);
      return { person, address: raw ? normaliseAddress(raw, campaign.channel) : '' };
    });
    // A page repeated after a crash, or an address shared by two contacts, is not queued twice.
    const existing = await existingRecipients(campaign.id, candidates.map((candidate) => candidate.person.id), candidates.map((candidate) => candidate.address).filter(Boolean));
    const seenPeople = new Set(existing.map((row) => row.personId));
    const seen = new Set(existing.map((row) => row.destination));
    const rows: Record<string, unknown>[] = [];
    for (const { person, address } of candidates) {
      if (seenPeople.has(person.id)) continue;
      const consent = campaign.channel === 'EMAIL' ? person.emailMarketingConsent : person.whatsappMarketingConsent;
      const usable = campaign.channel === 'EMAIL' ? isEmail(address) : /^\+[1-9][0-9]{7,14}$/.test(address);
      const reason = !consent
        ? 'Has not agreed to marketing.'
        : !usable
          ? campaign.channel === 'EMAIL' ? 'No valid email address.' : 'No mobile number with a country code.'
          : suppressed.has(address)
            ? 'On the do-not-contact list.'
            : seen.has(address)
              ? 'Same address as another contact.'
              : null;
      const name = ([person.name?.firstName, person.name?.lastName].filter(Boolean).join(' ') || address || 'Contact').slice(0, 200);
      rows.push(reason ? { name, destination: address, status: 'SKIPPED', error: reason, nonce: '', campaignId: campaign.id, personId: person.id } : { name, destination: address, status: 'QUEUED', nonce: newNonce(), campaignId: campaign.id, personId: person.id });
      if (!reason) seen.add(address);
      seenPeople.add(person.id);
    }
    await createRecipients(rows);
    cursor = page.next;
    await updateCampaign(campaign.id, { prepareCursor: cursor ?? 'DONE' });
    if (!cursor) return true;
  }
  return false;
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

// Status first with one filtered update (so a bounce that arrived meanwhile is kept), then the message ids.
const recordSent = async (batchKey: string, sent: { id: string; messageId: string | null }[], failed: { id: string; error: string }[]) => {
  const now = new Date().toISOString();
  if (sent.length) await updateRecipientsIf({ ids: sent.map((entry) => entry.id), batchKey, status: 'SENDING' }, { status: 'SENT', sentAt: now });
  for (const entry of failed) await updateRecipientsIf({ ids: [entry.id], status: 'SENDING' }, { status: 'FAILED', error: entry.error.slice(0, 300) });
  await updateRecipients(sent.filter((entry) => entry.messageId).map((entry) => ({ id: entry.id, data: { providerMessageId: entry.messageId, sentAt: now } })));
};

const sendEmailBatch = async (campaign: Campaign, brand: Brand, key: string, recipients: Recipient[], base: string, batchKey: string) => {
  const emails = recipients.map((recipient) => emailFor(campaign, brand, recipient, base));
  try {
    const ids = await sendBatch(key, emails, batchKey);
    await recordSent(
      batchKey,
      recipients.flatMap((recipient, index) => (ids[index] ? [{ id: recipient.id, messageId: ids[index] }] : [])),
      recipients.flatMap((recipient, index) => (ids[index] ? [] : [{ id: recipient.id, error: 'Resend did not accept this message.' }])),
    );
  } catch (error) {
    // A batch is refused as a whole when one message is invalid, so send that batch one by one to find it.
    if (!(error instanceof ResendError) || (error.status !== 400 && error.status !== 422)) throw error;
    const sent: { id: string; messageId: string | null }[] = [];
    const failed: { id: string; error: string }[] = [];
    try {
      for (const [index, email] of emails.entries()) {
        try {
          sent.push({ id: recipients[index].id, messageId: await sendOne(key, email, `${batchKey}:${index}`) });
        } catch (single) {
          if (single instanceof ResendError && (single.status === 400 || single.status === 422)) failed.push({ id: recipients[index].id, error: single.message });
          else throw single;
        }
      }
    } finally {
      await recordSent(batchKey, sent, failed);
    }
  }
};

// Hands one batch to InventiveChat, which owns the WhatsApp number, templates and the Meta connection. The batch id
// lets the gateway drop a batch it already accepted when a timed-out request is retried.
const sendWhatsAppBatch = async (campaign: Campaign, recipients: Recipient[], base: string, batchKey: string) => {
  const { WHATSAPP_GATEWAY_URL, WHATSAPP_GATEWAY_SECRET } = process.env;
  if (!WHATSAPP_GATEWAY_URL || !WHATSAPP_GATEWAY_SECRET) throw new CampaignError('WhatsApp sending is not set up on this server yet.');
  const body = JSON.stringify({
    event: 'campaign.message',
    campaignId: campaign.id,
    batchId: batchKey,
    template: { name: campaign.whatsappTemplate, language: campaign.whatsappVariables.language || 'en' },
    messages: recipients.map((recipient) => {
      const contact = contactOf(recipient.person ? { ...recipient.person, emails: null } : null);
      return {
        recipientId: recipient.id,
        to: recipient.address,
        variables: Object.entries(campaign.whatsappVariables)
          .filter(([name, value]) => /^\d+$/.test(name) && typeof value === 'string')
          .sort(([left], [right]) => Number(left) - Number(right))
          .map(([, value]) => String(value).replace(/\{\{\s*firstName\s*\}\}/g, contact.firstName || 'there').replace(/\{\{\s*lastName\s*\}\}/g, contact.lastName ?? '')),
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
  if (response.status >= 500) throw new ResendError(`The WhatsApp service answered ${response.status}`, response.status, 'gateway_error');
  if (!response.ok) throw new CampaignError(`The WhatsApp service answered ${response.status}${reply.error ? `: ${reply.error}` : ''}`);
  const accepted = new Map((reply.accepted ?? []).map((entry) => [entry.recipientId, entry.messageId ?? '']));
  await recordSent(
    batchKey,
    recipients.flatMap((recipient) => (accepted.has(recipient.id) ? [{ id: recipient.id, messageId: accepted.get(recipient.id) || null }] : [])),
    recipients.flatMap((recipient) => (accepted.has(recipient.id) ? [] : [{ id: recipient.id, error: 'The WhatsApp service did not accept this message.' }])),
  );
};

// Consent and the do-not-contact list are checked again right before each batch: a campaign can wait days for a
// quota to reset, and people unsubscribe in the meantime.
const holdBack = async (campaign: Campaign, recipients: Recipient[]) => {
  const consent = new Map((await consentOf(recipients.flatMap((recipient) => (recipient.personId ? [recipient.personId] : [])))).map((person) => [person.id, campaign.channel === 'EMAIL' ? person.emailMarketingConsent : person.whatsappMarketingConsent]));
  const suppressed = await suppressedAmong(recipients.map((recipient) => recipient.address), campaign.channel);
  const reasons = new Map<string, string>();
  for (const recipient of recipients) {
    if (!recipient.personId || !consent.has(recipient.personId)) reasons.set(recipient.id, 'The contact was deleted.');
    else if (!consent.get(recipient.personId)) reasons.set(recipient.id, 'Withdrew consent before sending.');
    else if (suppressed.has(recipient.address)) reasons.set(recipient.id, 'On the do-not-contact list.');
  }
  for (const reason of new Set(reasons.values()))
    await updateRecipientsIf({ ids: [...reasons].filter(([, value]) => value === reason).map(([id]) => id), status: 'QUEUED' }, { status: 'SKIPPED', error: reason });
  return recipients.filter((recipient) => !reasons.has(recipient.id));
};

const RETRY_WINDOW_MS = 23 * 3_600_000;

const deliver = async (campaign: Campaign, brand: Brand, key: string | null, recipients: Recipient[], base: string, batchKey: string) => {
  if (campaign.channel === 'EMAIL') await sendEmailBatch(campaign, brand, key as string, recipients, base, batchKey);
  else await sendWhatsAppBatch(campaign, recipients, base, batchKey);
};

// A run that died mid-batch leaves rows in SENDING. They are sent again with the same idempotency key, which Resend
// answers from its record of the first attempt; past its 24-hour memory they are marked failed instead of risked.
const recoverInFlight = async (campaign: Campaign, brand: Brand, key: string | null, base: string) => {
  const rows = await inFlightRecipients(campaign.id);
  for (const batchKey of new Set(rows.map((row) => row.batchKey).filter((value): value is string => Boolean(value)))) {
    const batch = await batchRecipients(batchKey);
    if (batch.length === 0) continue;
    if (Date.now() - Date.parse(batch[0].updatedAt) > RETRY_WINDOW_MS) {
      await updateRecipientsIf({ batchKey, status: 'SENDING' }, { status: 'FAILED', error: 'Sending was interrupted and could not be confirmed.' });
      continue;
    }
    await deliver(campaign, brand, key, batch, base, batchKey);
  }
};

const MAX_BATCHES_PER_RUN = 40;

const sendSome = async (campaign: Campaign, brand: Brand, base: string, timeLeft: () => number, outcome: { batches: number; finished: number }) => {
  let key: string | null = null;
  if (campaign.channel === 'EMAIL') {
    key = await resendKey();
    if (!key) throw new CampaignError('The Resend account was disconnected. Connect it again, then resume the campaign.');
    const domains = await listDomains(key);
    if (!domains.some((domain) => domain.name === campaign.fromDomain.trim().toLowerCase() && domain.status === 'verified'))
      throw new CampaignError(`The domain ${campaign.fromDomain} is no longer verified in your Resend account.`);
  }
  await recoverInFlight(campaign, brand, key, base);
  while (timeLeft() > PAGE_BUDGET_MS && outcome.batches < MAX_BATCHES_PER_RUN) {
    // Re-read each time, so "Stop sending" takes effect before the next batch.
    if ((await campaignStatus(campaign.id)) !== 'SENDING') return;
    const candidates = await queuedRecipients(campaign.id, BATCH_SIZE);
    if (candidates.length === 0) {
      if ((await inFlightRecipients(campaign.id)).length === 0 && (await updateCampaignIf(campaign.id, ['SENDING'], { status: 'SENT', sentAt: new Date().toISOString(), lastError: '' }))) outcome.finished += 1;
      return;
    }
    const sendable = await holdBack(campaign, candidates);
    if (sendable.length === 0) continue;
    const batchKey = `${campaign.id}:${randomUUID()}`;
    const claimed = await claimBatch(
      sendable.map((recipient) => recipient.id),
      batchKey,
    );
    if (claimed.length === 0) continue;
    await deliver(campaign, brand, key, claimed, base, batchKey);
    outcome.batches += 1;
  }
};

const RUN_BUDGET_MS = 90_000;

const failCampaign = (campaignId: string, message: string) => updateCampaignIf(campaignId, ['SCHEDULED', 'PREPARING', 'SENDING'], { status: 'FAILED', lastError: message.slice(0, 500) });

// Only real network failures and the provider's own "slow down" or outage answers are worth retrying.
export const isTransient = (error: unknown) => {
  if (error instanceof ResendError) return error.status === 429 || error.status === 409 || error.status >= 500;
  if (!(error instanceof Error)) return false;
  return error.name === 'TimeoutError' || error.name === 'AbortError' || (error.name === 'TypeError' && error.message === 'fetch failed');
};

const pauseMessage = (error: unknown) =>
  error instanceof ResendError && (error.code === 'daily_quota_exceeded' || error.code === 'monthly_quota_exceeded')
    ? 'Your Resend plan limit is reached. Sending continues automatically when it resets.'
    : error instanceof ResendError && error.status === 429
      ? 'Resend asked us to slow down. Sending continues shortly.'
      : 'The sending service could not be reached. Sending is retried every two minutes.';

export const runCampaigns = async (now = Date.now()) => {
  const started = Date.now();
  const timeLeft = () => RUN_BUDGET_MS - (Date.now() - started);
  const outcome = { started: 0, batches: 0, finished: 0, paused: [] as string[] };
  const base = await functionsBaseUrl();
  const brand = await loadBrand();

  for (const campaign of await campaignsWithStatus(['SCHEDULED'])) {
    if (!campaign.scheduledAt || new Date(campaign.scheduledAt).getTime() > now) continue;
    const problems = await campaignProblems(campaign, brand);
    // Resend being briefly unreachable is no reason to fail a campaign; it starts on a later run.
    if (problems.length === 1 && problems[0] === RESEND_UNREACHABLE) await updateCampaign(campaign.id, { lastError: RESEND_UNREACHABLE });
    else if (problems.length) await failCampaign(campaign.id, problems.join(' '));
    else if (await updateCampaignIf(campaign.id, ['SCHEDULED'], { status: 'PREPARING', startedAt: new Date().toISOString(), lastError: '', prepareCursor: '' })) outcome.started += 1;
  }

  for (const listed of await campaignsWithStatus(['PREPARING', 'SENDING'])) {
    if (timeLeft() < PAGE_BUDGET_MS) break;
    if (!(await acquireLease(listed.id))) continue;
    try {
      let campaign = listed;
      if (campaign.status === 'PREPARING') {
        if (!(await prepareSome(campaign, timeLeft))) continue;
        if (!(await updateCampaignIf(campaign.id, ['PREPARING'], { status: 'SENDING' }))) continue;
        campaign = { ...campaign, status: 'SENDING' };
      }
      await sendSome(campaign, brand, base, timeLeft, outcome);
    } catch (error) {
      if (isTransient(error)) {
        await updateCampaign(listed.id, { lastError: pauseMessage(error) });
        outcome.paused.push(listed.id);
      } else {
        if (!(error instanceof CampaignError)) console.error(`campaign ${listed.id}: ${(error as Error).stack ?? error}`);
        await failCampaign(listed.id, (error as Error).message);
      }
    } finally {
      await releaseLease(listed.id).catch(() => {});
      await recountCampaign(listed.id).catch(() => {});
    }
  }

  for (const campaign of await recentlySent(new Date(now - 14 * 86_400_000).toISOString())) await recountCampaign(campaign.id);
  return outcome;
};
