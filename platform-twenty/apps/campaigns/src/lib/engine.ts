import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { type CampaignChannel } from 'src/constants/enums';
import { metadata, TwentyUnavailableError } from 'src/lib/api';
import { designProblems, renderEmail, type Brand, type Contact } from 'src/lib/design';
import {
  acceptedEarlier,
  BATCH_SIZE,
  isInvalidMessage,
  isQuotaReached,
  listDomains,
  refusedOutright,
  ResendError,
  resendKey,
  retryDelayMs,
  sendBatch,
  sendOne,
  type OutgoingEmail,
} from 'src/lib/resend';
import {
  acquireLease,
  ALL_CONSENTED,
  audiencePage,
  batchRecipients,
  type Campaign,
  campaignStatus,
  campaignsWithStatus,
  claimBatch,
  type ContactState,
  contactOf,
  createRecipients,
  currentContacts,
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
  releaseBatch,
  releaseLease,
  suppressedAddresses,
  suppressedAmong,
  updateCampaign,
  updateCampaignIf,
  updateRecipientsIf,
} from 'src/lib/store';
import { newNonce, recipientToken } from 'src/lib/tokens';

export class CampaignError extends Error {}

export const functionsBaseUrl = async () => {
  if (process.env.TWENTY_FUNCTIONS_URL) return process.env.TWENTY_FUNCTIONS_URL.replace(/\/$/, '');
  const { currentWorkspace } = await metadata<{ currentWorkspace: { workspaceUrls: { customUrl: string | null; subdomainUrl: string } } }>(`{ currentWorkspace { workspaceUrls { customUrl subdomainUrl } } }`);
  return `${(currentWorkspace.workspaceUrls.customUrl || currentWorkspace.workspaceUrls.subdomainUrl).replace(/\/$/, '')}/s`;
};

// A path such as /s/whatsapp/gateway means the WhatsApp app of this same workspace: the variable is shared by every
// workspace, but each workspace's messages must leave through its own InventiveChat account.
export const resolveGatewayUrl = (configured: string, ownBase: string) => (configured.startsWith('/') ? `${new URL(ownBase).origin}${configured}` : configured);

export const unsubscribeUrl = (base: string, recipient: Pick<Recipient, 'id' | 'nonce'>) => `${base}/campaigns/unsubscribe/${recipientToken(recipient.id, recipient.nonce)}`;

const EMAIL_PATTERN = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;

export const isEmail = (value: string) => value.length <= 254 && EMAIL_PATTERN.test(value);

export const isLocalPart = (value: string) => /^[a-z0-9._+-]{1,64}$/i.test(value.trim());

export const fromAddress = (campaign: Pick<Campaign, 'fromName' | 'fromLocalPart' | 'fromDomain'>) => {
  const name = campaign.fromName.replace(/["<>\r\n]/g, '').trim();
  const address = `${campaign.fromLocalPart.trim().toLowerCase()}@${campaign.fromDomain.trim().toLowerCase()}`;
  return name ? `"${name}" <${address}>` : address;
};

export const RESEND_UNREACHABLE = 'Resend could not be reached to check your sending domain. Try again in a minute.';

// What can be checked without asking Resend. Also checked again when a prepared campaign starts sending, because the
// campaign record can be edited in the CRM in the meantime.
export const contentProblems = (campaign: Campaign, brand: Brand) => {
  const problems: string[] = [];
  if (!campaign.listId) problems.push('Choose who to send it to.');
  if (campaign.channel === 'EMAIL') {
    if (!campaign.subject.trim()) problems.push('Add a subject line.');
    if (!isLocalPart(campaign.fromLocalPart)) problems.push('Choose a sending address.');
    if (campaign.replyTo && !isEmail(campaign.replyTo.trim())) problems.push('The reply-to address is not a valid email address.');
    problems.push(...designProblems(campaign.design, brand));
  } else {
    if (!/^[a-z0-9_]{1,512}$/.test(campaign.whatsappTemplate)) problems.push('Choose an approved WhatsApp template (its name, in lower case).');
    if (!process.env.WHATSAPP_GATEWAY_URL || !process.env.WHATSAPP_GATEWAY_SECRET) problems.push('WhatsApp sending is not set up on this server yet.');
  }
  return problems;
};

// Everything that must be true before a campaign may leave; the studio shows the same list before scheduling.
export const campaignProblems = async (campaign: Campaign, brand: Brand) => {
  const problems = contentProblems(campaign, brand);
  if (campaign.channel !== 'EMAIL') return problems;
  const key = await resendKey();
  if (!key) problems.push('Connect your Resend account under Settings, Accounts.');
  else {
    const domains = await listDomains(key).catch(() => null);
    if (!domains) problems.push(RESEND_UNREACHABLE);
    else if (!campaign.fromDomain.trim()) problems.push('Choose the domain to send from.');
    else if (!domains.some((domain) => domain.name === campaign.fromDomain.trim().toLowerCase() && domain.status === 'verified'))
      problems.push(`The domain ${campaign.fromDomain} is not verified in your Resend account.`);
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

export const addressOf = (person: Pick<Person, 'emails' | 'phones'>, channel: CampaignChannel) => normaliseAddress(channel === 'EMAIL' ? (person.emails?.primaryEmail ?? '') : phoneOf(person.phones), channel);

export const STOPPED = 'Stopped before sending.';

const RUN_BUDGET_MS = 90_000;
const PAGE_BUDGET_MS = 15_000;
// A provider call may take its full 30 s timeout and must then be recorded before the lease or the function runs out.
const SEND_BUDGET_MS = 45_000;

// Turns one page of the audience after another into recipient rows until the run's time is used up. Everyone gets a
// row, so the report can say why someone was skipped. Returns true once the whole audience is done.
const prepareSome = async (campaign: Campaign, timeLeft: () => number) => {
  // A run can stop between finishing the audience and moving the campaign on.
  if (campaign.prepareCursor === 'DONE') return true;
  if (campaign.listId !== ALL_CONSENTED && !(await getMailingList(campaign.listId))) throw new CampaignError('The mailing list no longer exists.');
  const suppressed = await suppressedAddresses(campaign.channel);
  let cursor = campaign.prepareCursor || null;
  while (timeLeft() > PAGE_BUDGET_MS) {
    if ((await campaignStatus(campaign.id)) !== 'PREPARING') return false;
    const page = await audiencePage(campaign.listId, campaign.channel, cursor);
    const candidates = page.people.map((person) => ({ person, address: addressOf(person, campaign.channel) }));
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
      const { firstName, lastName, companyName } = contactOf(person);
      rows.push(
        reason
          ? { name, destination: address, status: 'SKIPPED', error: reason, nonce: '', campaignId: campaign.id, personId: person.id }
          : { name, destination: address, status: 'QUEUED', nonce: newNonce(), campaignId: campaign.id, personId: person.id, personalisation: { firstName, lastName, companyName } },
      );
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

// Personalised from what was stored when the audience was prepared, so a retried batch repeats the request first sent
// under its idempotency key. Rows prepared before that was stored fall back to the contact record.
const contactFor = (recipient: Recipient): Contact => recipient.personalisation ?? contactOf(recipient.person ? { ...recipient.person, emails: null } : null);

const emailFor = (campaign: Campaign, brand: Brand, recipient: Recipient, base: string): OutgoingEmail => {
  const contact: Contact = { ...contactFor(recipient), email: recipient.address };
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

// Filtered on SENDING, so a delivery or bounce a webhook recorded meanwhile is kept. Provider message ids are not
// stored: events carry the recipient tag, which is how the webhook finds the row.
const recordSent = async (batchKey: string, sentIds: string[], failed: { id: string; error: string }[]) => {
  if (sentIds.length) await updateRecipientsIf({ ids: sentIds, batchKey, status: 'SENDING' }, { status: 'SENT', sentAt: new Date().toISOString() });
  for (const error of new Set(failed.map((entry) => entry.error)))
    await updateRecipientsIf({ ids: failed.filter((entry) => entry.error === error).map((entry) => entry.id), batchKey, status: 'SENDING' }, { status: 'FAILED', error: error.slice(0, 300) });
};

const SINGLE_SEND_GAP_MS = 600;

// By recipient, not position, so a retry reuses each message's key however many rows of the batch moved on since.
export const singleSendKey = (batchKey: string, recipientId: string) => `${batchKey}:${recipientId}`;

// Single sends start at least SINGLE_SEND_GAP_MS apart, which stays under Resend's default rate limit.
export const paceDelay = (lastStartedAt: number, now: number) => Math.max(0, lastStartedAt + SINGLE_SEND_GAP_MS - now);

const sendSingle = async (key: string, email: OutgoingEmail, idempotencyKey: string, timeLeft: () => number) => {
  try {
    return await sendOne(key, email, idempotencyKey);
  } catch (error) {
    const wait = retryDelayMs(error);
    if (wait === null || timeLeft() - wait < SEND_BUDGET_MS) throw error;
    await sleep(wait);
    return sendOne(key, email, idempotencyKey);
  }
};

// A batch is refused as a whole when one message is invalid, so the rows still waiting go one by one to find it. Rows
// left when time runs out stay SENDING for the next run, which retries them under the same keys.
const sendOneByOne = async (campaign: Campaign, brand: Brand, key: string, recipients: Recipient[], base: string, batchKey: string, timeLeft: () => number) => {
  const sent: string[] = [];
  const failed: { id: string; error: string }[] = [];
  let lastStartedAt = 0;
  try {
    for (const recipient of recipients) {
      if (timeLeft() < SEND_BUDGET_MS) break;
      await sleep(paceDelay(lastStartedAt, Date.now()));
      lastStartedAt = Date.now();
      try {
        await sendSingle(key, emailFor(campaign, brand, recipient, base), singleSendKey(batchKey, recipient.id), timeLeft);
        sent.push(recipient.id);
      } catch (error) {
        if (acceptedEarlier(error)) sent.push(recipient.id);
        else if (isInvalidMessage(error)) failed.push({ id: recipient.id, error: (error as Error).message });
        else throw error;
      }
    }
  } finally {
    await recordSent(batchKey, sent, failed);
  }
};

// The request always holds every row of the batch in its original order, so a retry matches the first attempt.
const sendEmailBatch = async (campaign: Campaign, brand: Brand, key: string, batch: Recipient[], base: string, batchKey: string, timeLeft: () => number) => {
  const waiting = batch.filter((recipient) => recipient.status === 'SENDING');
  let ids: string[];
  try {
    ids = await sendBatch(key, batch.map((recipient) => emailFor(campaign, brand, recipient, base)), batchKey);
  } catch (error) {
    if (acceptedEarlier(error)) {
      await recordSent(batchKey, waiting.map((recipient) => recipient.id), []);
      return;
    }
    if (!isInvalidMessage(error)) throw error;
    await sendOneByOne(campaign, brand, key, waiting, base, batchKey, timeLeft);
    return;
  }
  await recordSent(
    batchKey,
    batch.flatMap((recipient, index) => (ids[index] ? [recipient.id] : [])),
    batch.flatMap((recipient, index) => (ids[index] ? [] : [{ id: recipient.id, error: 'Resend did not accept this message.' }])),
  );
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
      const contact = contactFor(recipient);
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
  const response = await fetch(resolveGatewayUrl(WHATSAPP_GATEWAY_URL, base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-InventiveCRM-Timestamp': timestamp, 'X-InventiveCRM-Signature': `sha256=${signature}` },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const reply = (await response.json().catch(() => ({}))) as { accepted?: { recipientId: string }[]; error?: string };
  if (response.status >= 500) throw new ResendError(`The WhatsApp service answered ${response.status}`, response.status, 'gateway_error');
  if (!response.ok) throw new CampaignError(`The WhatsApp service answered ${response.status}${reply.error ? `: ${reply.error}` : ''}`);
  const accepted = new Set((reply.accepted ?? []).map((entry) => entry.recipientId));
  await recordSent(
    batchKey,
    recipients.flatMap((recipient) => (accepted.has(recipient.id) ? [recipient.id] : [])),
    recipients.flatMap((recipient) => (accepted.has(recipient.id) ? [] : [{ id: recipient.id, error: 'The WhatsApp service did not accept this message.' }])),
  );
};

export const holdBackReason = (recipient: Pick<Recipient, 'address'>, person: ContactState | undefined, channel: CampaignChannel, isSuppressed: (address: string) => boolean) => {
  if (!person) return 'The contact was deleted.';
  if (!(channel === 'EMAIL' ? person.emailMarketingConsent : person.whatsappMarketingConsent)) return 'Withdrew consent before sending.';
  if (addressOf(person, channel) !== recipient.address) return 'Their address changed after the campaign was prepared.';
  if (isSuppressed(recipient.address)) return 'On the do-not-contact list.';
  return null;
};

// Consent, the address and the do-not-contact list are checked again right before each batch: a campaign can wait days
// for a quota to reset, and people unsubscribe or change address in the meantime.
const holdBack = async (campaign: Campaign, recipients: Recipient[], suppressedAtStart: Set<string>) => {
  const people = new Map((await currentContacts(recipients.flatMap((recipient) => (recipient.personId ? [recipient.personId] : [])))).map((person) => [person.id, person]));
  const suppressed = await suppressedAmong(recipients.map((recipient) => recipient.address), campaign.channel);
  const reasons = new Map<string, string>();
  for (const recipient of recipients) {
    const reason = holdBackReason(recipient, recipient.personId ? people.get(recipient.personId) : undefined, campaign.channel, (address) => suppressed.has(address) || suppressedAtStart.has(address));
    if (reason) reasons.set(recipient.id, reason);
  }
  for (const reason of new Set(reasons.values()))
    await updateRecipientsIf({ ids: [...reasons].filter(([, value]) => value === reason).map(([id]) => id), status: 'QUEUED' }, { status: 'SKIPPED', error: reason });
  return recipients.filter((recipient) => !reasons.has(recipient.id));
};

const RETRY_WINDOW_MS = 23 * 3_600_000;

const deliver = async (campaign: Campaign, brand: Brand, key: string | null, recipients: Recipient[], base: string, batchKey: string, timeLeft: () => number) => {
  if (campaign.channel === 'EMAIL') await sendEmailBatch(campaign, brand, key as string, recipients, base, batchKey, timeLeft);
  else await sendWhatsAppBatch(campaign, recipients, base, batchKey);
};

// A run that died mid-batch leaves rows in SENDING. The batch is rebuilt as first sent and sent again with the same
// idempotency key, which Resend answers from its record of the first attempt; past its 24-hour memory the rows are
// marked failed instead of risked. Returns false when time ran out first.
const recoverInFlight = async (campaign: Campaign, brand: Brand, key: string | null, base: string, timeLeft: () => number) => {
  const rows = await inFlightRecipients(campaign.id);
  for (const batchKey of new Set(rows.flatMap((row) => (row.batchKey ? [row.batchKey] : [])))) {
    if (timeLeft() < SEND_BUDGET_MS) return false;
    const batch = await batchRecipients(campaign.id, batchKey);
    if (batch.length === 0) continue;
    const claimedAt = Math.min(...batch.map((row) => Date.parse(row.updatedAt)));
    if (Date.now() - claimedAt > RETRY_WINDOW_MS) {
      await updateRecipientsIf({ campaignId: campaign.id, batchKey, status: 'SENDING' }, { status: 'FAILED', error: 'Sending was interrupted and could not be confirmed.' });
      continue;
    }
    await deliver(campaign, brand, key, batch, base, batchKey, timeLeft);
  }
  return true;
};

const MAX_BATCHES_PER_RUN = 40;

const sendSome = async (campaign: Campaign, brand: Brand, base: string, timeLeft: () => number, outcome: { batches: number; finished: number }) => {
  if (timeLeft() < SEND_BUDGET_MS) return;
  let key: string | null = null;
  if (campaign.channel === 'EMAIL') {
    key = await resendKey();
    if (!key) throw new CampaignError('The Resend account was disconnected. Connect it again, then resume the campaign.');
    const domains = await listDomains(key);
    if (!domains.some((domain) => domain.name === campaign.fromDomain.trim().toLowerCase() && domain.status === 'verified'))
      throw new CampaignError(`The domain ${campaign.fromDomain} is no longer verified in your Resend account.`);
  }
  // Normalised like at preparation, so an entry typed by hand in another case still counts.
  const suppressedAtStart = await suppressedAddresses(campaign.channel);
  if (!(await recoverInFlight(campaign, brand, key, base, timeLeft))) return;
  while (timeLeft() > SEND_BUDGET_MS && outcome.batches < MAX_BATCHES_PER_RUN) {
    // Re-read each time, so "Stop sending" takes effect before the next batch.
    if ((await campaignStatus(campaign.id)) !== 'SENDING') return;
    const candidates = await queuedRecipients(campaign.id, BATCH_SIZE);
    if (candidates.length === 0) {
      if ((await inFlightRecipients(campaign.id)).length === 0 && (await updateCampaignIf(campaign.id, ['SENDING'], { status: 'SENT', sentAt: new Date().toISOString(), lastError: '' }))) outcome.finished += 1;
      return;
    }
    const sendable = await holdBack(campaign, candidates, suppressedAtStart);
    if (sendable.length === 0) continue;
    const batchKey = `${campaign.id}:${randomUUID()}`;
    const claimed = await claimBatch(
      campaign.id,
      sendable.map((recipient) => recipient.id),
      batchKey,
    );
    if (claimed.length === 0) continue;
    try {
      await deliver(campaign, brand, key, claimed, base, batchKey, timeLeft);
    } catch (error) {
      // Only a first attempt is put back: a retried batch may have been taken the first time.
      if (refusedOutright(error)) await releaseBatch(campaign.id, batchKey);
      throw error;
    }
    outcome.batches += 1;
  }
};

const failCampaign = (campaignId: string, message: string) => updateCampaignIf(campaignId, ['SCHEDULED', 'PREPARING', 'SENDING'], { status: 'FAILED', lastError: message.slice(0, 500) });

// Twenty's own wording when its database timed out or lost the connection; other GraphQL errors are real faults.
const TWENTY_DATABASE_HICCUP = /^GraphQL error: .*(Query read timeout|Connection terminated)/;

const isTwentyHiccup = (error: unknown) => error instanceof TwentyUnavailableError || (error instanceof Error && TWENTY_DATABASE_HICCUP.test(error.message));

// Only network failures, the provider's own "slow down" or outage answers and Twenty being briefly unavailable are
// worth retrying.
export const isTransient = (error: unknown) => {
  if (error instanceof ResendError) return error.status === 429 || (error.status === 409 && !acceptedEarlier(error)) || error.status >= 500;
  if (isTwentyHiccup(error)) return true;
  if (!(error instanceof Error)) return false;
  return error.name === 'TimeoutError' || error.name === 'AbortError' || (error.name === 'TypeError' && error.message === 'fetch failed');
};

const pauseMessage = (error: unknown) =>
  isQuotaReached(error)
    ? 'Your Resend plan limit is reached. Sending continues automatically when it resets.'
    : error instanceof ResendError && error.status === 429
      ? 'Resend asked us to slow down. Sending continues shortly.'
      : isTwentyHiccup(error)
        ? 'The CRM was busy or restarting. Sending is retried every two minutes.'
        : 'The sending service could not be reached. Sending is retried every two minutes.';

export const runCampaigns = async (now = Date.now()) => {
  const started = Date.now();
  const timeLeft = () => RUN_BUDGET_MS - (Date.now() - started);
  const outcome = { started: 0, batches: 0, finished: 0, paused: [] as string[] };
  const base = await functionsBaseUrl();
  const { id: _brandId, ...brand } = await loadBrand();
  // A campaign keeps the brand kit it started with, so every batch, and every retry of one, renders the same.
  const brandFor = (campaign: Campaign) => campaign.brandSnapshot ?? brand;

  for (const campaign of await campaignsWithStatus(['SCHEDULED'])) {
    if (!campaign.scheduledAt || new Date(campaign.scheduledAt).getTime() > now) continue;
    const problems = await campaignProblems(campaign, brand);
    // Resend being briefly unreachable is no reason to fail a campaign; it starts on a later run.
    if (problems.length === 1 && problems[0] === RESEND_UNREACHABLE) await updateCampaign(campaign.id, { lastError: RESEND_UNREACHABLE });
    else if (problems.length) await failCampaign(campaign.id, problems.join(' '));
    else if (await updateCampaignIf(campaign.id, ['SCHEDULED'], { status: 'PREPARING', startedAt: new Date().toISOString(), lastError: '', prepareCursor: '', brandSnapshot: brand })) outcome.started += 1;
  }

  for (const listed of await campaignsWithStatus(['PREPARING', 'SENDING'])) {
    if (timeLeft() < PAGE_BUDGET_MS) break;
    if (!(await acquireLease(listed.id))) continue;
    try {
      let campaign = listed;
      if (campaign.status === 'PREPARING') {
        if (!(await prepareSome(campaign, timeLeft))) continue;
        const problems = contentProblems(campaign, brandFor(campaign));
        if (problems.length) {
          await failCampaign(campaign.id, problems.join(' '));
          continue;
        }
        if (!(await updateCampaignIf(campaign.id, ['PREPARING'], { status: 'SENDING' }))) continue;
        campaign = { ...campaign, status: 'SENDING' };
      }
      await sendSome(campaign, brandFor(campaign), base, timeLeft, outcome);
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

  for (const campaign of await recentlySent(new Date(now - 14 * 86_400_000).toISOString())) {
    if (timeLeft() <= 0) break;
    await recountCampaign(campaign.id, campaign.counts);
  }
  return outcome;
};
