import { type Channel, type RequestStatus, type Source } from 'src/constants/enums';
import { gql, nodes, TwentyUnavailableError } from 'src/lib/api';
import { sendSurveyEmail, sendSurveyWhatsApp, toE164 } from 'src/lib/send';
import { type FeedbackSettings, updateSettings } from 'src/lib/settings';
import { newNonce, surveyToken } from 'src/lib/tokens';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SCAN_PAGE_SIZE = 200;
const MAX_ATTEMPTS = 3;
// A send takes seconds, so a request still Sending after this was cut off and may or may not have gone out.
const INTERRUPTED_AFTER_MS = 30 * MINUTE;
// The job may run for 300 s; stop taking new requests early enough to record the ones already sent.
const SEND_TIME_BUDGET_MS = 240_000;
// Failed and skipped requests reached nobody, so they do not start the cool-down.
const COOLDOWN_STATUSES: RequestStatus[] = ['SCHEDULED', 'SENDING', 'SENT', 'ANSWERED', 'EXPIRED'];

export type Candidate = { source: Source; sourceId: string; personId: string | null; name: string };

type Person = {
  id: string;
  name: { firstName: string; lastName: string } | null;
  emails: { primaryEmail: string | null } | null;
  phones: { primaryPhoneNumber: string | null; primaryPhoneCallingCode: string | null } | null;
  whatsappOptIn?: boolean | null;
};

export type FeedbackRequest = {
  id: string;
  name: string;
  status: RequestStatus;
  channel: Channel;
  source: Source;
  sourceId: string;
  score: number | null;
  comment: string;
  nonce: string;
  sendAt: string | null;
  expiresAt: string | null;
  answeredAt: string | null;
  reviewLinkShown: boolean;
  followUpTaskId: string;
  personId: string | null;
  attempts: number | null;
};

export const REQUEST_FIELDS = 'id name status channel source sourceId score comment nonce sendAt expiresAt answeredAt reviewLinkShown followUpTaskId personId attempts';

export const updateRequest = (id: string, data: Record<string, unknown>) =>
  gql(`mutation($id: UUID!, $data: FeedbackRequestUpdateInput!) { updateFeedbackRequest(id: $id, data: $data) { id } }`, { id, data });

// One UPDATE ... WHERE: only rows still matching the filter change, and only those come back.
export const updateRequestsWhere = async (filter: Record<string, unknown>, data: Record<string, unknown>) =>
  (
    await gql<{ updateFeedbackRequests: { id: string }[] }>(
      `mutation($filter: FeedbackRequestFilterInput!, $data: FeedbackRequestUpdateInput!) { updateFeedbackRequests(filter: $filter, data: $data) { id } }`,
      { filter, data },
    )
  ).updateFeedbackRequests;

// A source app that is not installed has no such query or type. Anything else must stop the scan so its cursor stays put.
export const isMissingSourceAppError = (error: unknown) =>
  error instanceof Error && !(error instanceof TwentyUnavailableError) && /Cannot query field|Unknown type/.test(error.message);

type ScanPage = { candidates: Candidate[]; full: boolean; lastUpdatedAt: string | null };

const NOTHING_SCANNED: ScanPage = { candidates: [], full: false, lastUpdatedAt: null };

const scanSource = async <TRow extends { updatedAt: string }>(objectName: string, filter: string, fields: string, since: string, toCandidate: (row: TRow) => Candidate): Promise<ScanPage> => {
  try {
    const rows = nodes(
      (
        await gql<Record<string, { edges: { node: TRow }[] }>>(
          `query($since: DateTime!) { ${objectName}(filter: { ${filter}, updatedAt: { gte: $since } }, orderBy: [{ updatedAt: AscNullsLast }], first: ${SCAN_PAGE_SIZE}) { edges { node { ${fields} updatedAt } } } }`,
          { since },
        )
      )[objectName],
    );
    return { candidates: rows.map(toCandidate), full: rows.length === SCAN_PAGE_SIZE, lastUpdatedAt: rows.at(-1)?.updatedAt ?? null };
  } catch (error) {
    if (isMissingSourceAppError(error)) return NOTHING_SCANNED;
    throw error;
  }
};

export const findCandidates = (settings: FeedbackSettings, since: string): Promise<ScanPage[]> =>
  Promise.all([
    settings.afterAppointments
      ? scanSource<{ id: string; name: string; customerName: string; personId: string | null; updatedAt: string }>(
          'appointments',
          'status: { eq: COMPLETED }',
          'id name customerName personId',
          since,
          (row) => ({ source: 'APPOINTMENT', sourceId: row.id, personId: row.personId, name: row.customerName || row.name }),
        )
      : NOTHING_SCANNED,
    settings.afterPaidInvoices
      ? scanSource<{ id: string; invoiceNumber: string; personId: string | null; updatedAt: string }>(
          'invoices',
          'status: { eq: PAID }',
          'id invoiceNumber personId',
          since,
          (row) => ({ source: 'INVOICE', sourceId: row.id, personId: row.personId, name: `Invoice ${row.invoiceNumber}` }),
        )
      : NOTHING_SCANNED,
  ]);

// A source that filled its page resumes at its last row (scans use gte, so rows sharing that time are read again,
// not lost); otherwise everything changed before this run started has been seen.
export const nextScanCursor = (since: string, now: number, pages: Pick<ScanPage, 'full' | 'lastUpdatedAt'>[]) => {
  const resumeAt = pages.flatMap((page) => (page.full && page.lastUpdatedAt ? [Date.parse(page.lastUpdatedAt)] : []));
  if (resumeAt.length === 0) return new Date(now).toISOString();
  // A full page that never gets past `since` (one bulk update of more than a page) would be read forever.
  return new Date(Math.max(Math.min(now, ...resumeAt), Date.parse(since) + 1)).toISOString();
};

// One request per source record, and nobody is asked more often than the cool-down allows, including twice in one scan.
export const pickNewRequests = (candidates: Candidate[], requestedSourceIds: Set<string>, recentlyAskedPersonIds: Set<string>) => {
  const asked = new Set(recentlyAskedPersonIds);
  return candidates.filter((candidate) => {
    if (!candidate.personId || requestedSourceIds.has(candidate.sourceId) || asked.has(candidate.personId)) return false;
    asked.add(candidate.personId);
    return true;
  });
};

type Page<TNode> = { edges: { node: TNode }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };

const allRequestsWhere = async <TNode>(filter: Record<string, unknown>, fields: string) => {
  const rows: TNode[] = [];
  let after: string | null = null;
  do {
    const page: Page<TNode> = (
      await gql<{ feedbackRequests: Page<TNode> }>(
        `query($filter: FeedbackRequestFilterInput!, $after: String) { feedbackRequests(filter: $filter, orderBy: [{ id: AscNullsLast }], first: 200, after: $after) { edges { node { ${fields} } } pageInfo { hasNextPage endCursor } } }`,
        { filter, after },
      )
    ).feedbackRequests;
    rows.push(...nodes(page));
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return rows;
};

const isUniqueViolation = (error: unknown) => error instanceof Error && /duplicate|unique constraint/i.test(error.message);

export const createRequest = async (
  candidate: Candidate,
  settings: FeedbackSettings,
  now: number,
  sendAt = now + (settings.delayHours ?? 2) * HOUR,
  status: 'SCHEDULED' | 'SENDING' = 'SCHEDULED',
) => {
  const { createFeedbackRequest } = await gql<{ createFeedbackRequest: { id: string } }>(
    `mutation($data: FeedbackRequestCreateInput!) { createFeedbackRequest(data: $data) { id } }`,
    {
      data: {
        name: candidate.name || 'Feedback',
        status,
        channel: settings.channel,
        source: candidate.source,
        sourceId: candidate.sourceId,
        personId: candidate.personId,
        nonce: newNonce(),
        sendAt: new Date(sendAt).toISOString(),
      },
    },
  );
  return createFeedbackRequest.id;
};

export const scheduleNewRequests = async (settings: FeedbackSettings, now: number) => {
  // The first run only remembers where it started, so customers from before the app was switched on are not asked.
  if (!settings.lastScannedAt) {
    await updateSettings(settings.id, { lastScannedAt: new Date(now).toISOString() });
    return 0;
  }
  const pages = await findCandidates(settings, settings.lastScannedAt);
  const candidates = pages.flatMap((page) => page.candidates);
  const personIds = [...new Set(candidates.flatMap((candidate) => (candidate.personId ? [candidate.personId] : [])))];
  let created = 0;
  if (personIds.length > 0) {
    const cooldownStart = new Date(now - (settings.cooldownDays ?? 60) * DAY).toISOString();
    const [requested, recent] = await Promise.all([
      allRequestsWhere<{ sourceId: string }>({ sourceId: { in: candidates.map((candidate) => candidate.sourceId) } }, 'sourceId'),
      allRequestsWhere<{ personId: string }>({ personId: { in: personIds }, createdAt: { gte: cooldownStart }, status: { in: COOLDOWN_STATUSES } }, 'personId'),
    ]);
    for (const candidate of pickNewRequests(candidates, new Set(requested.map((row) => row.sourceId)), new Set(recent.map((row) => row.personId)))) {
      try {
        await createRequest(candidate, settings, now);
        created += 1;
      } catch (error) {
        // A parallel run has just scheduled it.
        if (!isUniqueViolation(error)) throw error;
      }
    }
  }
  await updateSettings(settings.id, { lastScannedAt: nextScanCursor(settings.lastScannedAt, now, pages) });
  return created;
};

const loadPerson = async (personId: string): Promise<Person | null> => {
  const query = (extra: string) => `query($id: UUID!) { people(filter: { id: { eq: $id } }) { edges { node { id name { firstName lastName } emails { primaryEmail } phones { primaryPhoneNumber primaryPhoneCallingCode } ${extra} } } } }`;
  // whatsappOptIn comes from the Quotes & Invoices app and is missing where that app is not installed.
  const data = await gql<{ people: { edges: { node: Person }[] } }>(query('whatsappOptIn'), { id: personId }).catch(() =>
    gql<{ people: { edges: { node: Person }[] } }>(query(''), { id: personId }),
  );
  return nodes(data.people)[0] ?? null;
};

export const surveyUrl = (base: string, request: { id: string; nonce: string }) => `${base}/feedback/${surveyToken(request.id, request.nonce)}`;

// Delay before the next try after `failedAttempts` failed ones, or null once every attempt is used.
export const retryDelay = (failedAttempts: number) => (failedAttempts >= MAX_ATTEMPTS ? null : 30 * MINUTE * 4 ** Math.max(0, failedAttempts - 1));

const recordFailure = async (request: FeedbackRequest, attempts: number, reason: string, now: number): Promise<RequestStatus> => {
  const delay = retryDelay(attempts);
  if (delay === null) {
    await updateRequest(request.id, { status: 'FAILED', attempts, error: reason });
    return 'FAILED';
  }
  await updateRequest(request.id, { status: 'SCHEDULED', attempts, sendAt: new Date(now + delay).toISOString(), error: `${reason} (attempt ${attempts} of ${MAX_ATTEMPTS}, trying again later)` });
  return 'SCHEDULED';
};

// The caller must hold the request in SENDING: a claimed request from the job, or one created that way by askNow.
export const sendRequest = async (request: FeedbackRequest, settings: FeedbackSettings, base: string, now: number): Promise<RequestStatus> => {
  const attempts = (request.attempts ?? 0) + 1;
  let person: Person | null;
  try {
    person = request.personId ? await loadPerson(request.personId) : null;
  } catch (error) {
    return recordFailure(request, attempts, `Could not read the customer: ${(error as Error).message}`, now);
  }
  const email = person?.emails?.primaryEmail?.trim() || '';
  const phone = person ? toE164(person.phones) : null;
  const wantsEmail = request.channel !== 'WHATSAPP';
  const wantsWhatsApp = request.channel !== 'EMAIL';
  const canWhatsApp = Boolean(phone && person?.whatsappOptIn);
  const url = surveyUrl(base, request);
  const firstName = person?.name?.firstName?.trim() || 'there';
  const sentTo: string[] = [];
  const problems: string[] = [];

  if (wantsEmail && email) {
    await sendSurveyEmail({ to: email, firstName, url, settings }).then(
      () => sentTo.push(email),
      (error: Error) => problems.push(`Email: ${error.message}`),
    );
  }
  if (wantsWhatsApp && canWhatsApp && phone) {
    await sendSurveyWhatsApp({ requestId: request.id, phone, name: `${person?.name?.firstName ?? ''} ${person?.name?.lastName ?? ''}`.trim(), url, settings }).then(
      () => sentTo.push(phone),
      (error: Error) => problems.push(`WhatsApp: ${error.message}`),
    );
  }

  const expiresAt = new Date(now + (settings.expiryDays ?? 14) * DAY).toISOString();
  if (sentTo.length > 0) {
    await updateRequest(request.id, { status: 'SENT', attempts, sentAt: new Date(now).toISOString(), expiresAt, recipient: sentTo.join(', '), error: problems.join('; ') });
    return 'SENT';
  }
  if (problems.length > 0) return recordFailure(request, attempts, problems.join('; '), now);
  await updateRequest(request.id, { status: 'SKIPPED', attempts, error: wantsWhatsApp && !wantsEmail ? 'No mobile number with WhatsApp consent.' : 'No email address.' });
  return 'SKIPPED';
};

export const sendDueRequests = async (settings: FeedbackSettings, base: string, now: number) => {
  const due = nodes(
    (
      await gql<{ feedbackRequests: { edges: { node: FeedbackRequest }[] } }>(
        `query($now: DateTime!) { feedbackRequests(filter: { status: { eq: SCHEDULED }, sendAt: { lte: $now } }, orderBy: [{ sendAt: AscNullsLast }], first: 100) { edges { node { ${REQUEST_FIELDS} } } } }`,
        { now: new Date(now).toISOString() },
      )
    ).feedbackRequests,
  );
  let sent = 0;
  for (const request of due) {
    if (Date.now() - now > SEND_TIME_BUDGET_MS) break;
    // The job and /feedback/run can overlap; only the run whose update moved the request to SENDING sends it.
    if ((await updateRequestsWhere({ id: { eq: request.id }, status: { eq: 'SCHEDULED' } }, { status: 'SENDING' })).length === 0) continue;
    try {
      if ((await sendRequest(request, settings, base, now)) === 'SENT') sent += 1;
    } catch (error) {
      // Left in SENDING for failInterruptedRequests: the survey may already have gone out.
      console.error(`feedback job: request ${request.id} failed while sending: ${(error as Error).message}`);
    }
  }
  return sent;
};

export const failInterruptedRequests = async (now: number) =>
  (
    await updateRequestsWhere(
      { status: { eq: 'SENDING' }, updatedAt: { lt: new Date(now - INTERRUPTED_AFTER_MS).toISOString() } },
      { status: 'FAILED', error: 'Sending was interrupted, so it is not known whether the customer received the survey. It was not sent again, to avoid asking twice.' },
    )
  ).length;

export const expireOldRequests = async (now: number) => {
  const old = nodes(
    (
      await gql<{ feedbackRequests: { edges: { node: { id: string } }[] } }>(
        `query($now: DateTime!) { feedbackRequests(filter: { status: { eq: SENT }, expiresAt: { lt: $now } }, first: 200) { edges { node { id } } } }`,
        { now: new Date(now).toISOString() },
      )
    ).feedbackRequests,
  );
  for (const request of old) await updateRequest(request.id, { status: 'EXPIRED' });
  return old.length;
};
