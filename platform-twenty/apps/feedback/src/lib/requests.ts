import { type Channel, type RequestStatus, type Source } from 'src/constants/enums';
import { gql, nodes } from 'src/lib/api';
import { sendSurveyEmail, sendSurveyWhatsApp, toE164 } from 'src/lib/send';
import { type FeedbackSettings, updateSettings } from 'src/lib/settings';
import { newNonce, surveyToken } from 'src/lib/tokens';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

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
};

export const REQUEST_FIELDS = 'id name status channel source sourceId score comment nonce sendAt expiresAt answeredAt reviewLinkShown followUpTaskId personId';

export const updateRequest = (id: string, data: Record<string, unknown>) =>
  gql(`mutation($id: UUID!, $data: FeedbackRequestUpdateInput!) { updateFeedbackRequest(id: $id, data: $data) { id } }`, { id, data });

// Optional sources: an app that is not installed in this workspace simply contributes nothing.
const optional = async <TValue>(load: () => Promise<TValue[]>) => {
  try {
    return await load();
  } catch {
    return [] as TValue[];
  }
};

export const findCandidates = async (settings: FeedbackSettings, since: string): Promise<Candidate[]> => {
  const [appointments, invoices] = await Promise.all([
    settings.afterAppointments
      ? optional(async () =>
          nodes(
            (
              await gql<{ appointments: { edges: { node: { id: string; name: string; customerName: string; personId: string | null } }[] } }>(
                `query($since: DateTime!) { appointments(filter: { status: { eq: COMPLETED }, updatedAt: { gt: $since } }, first: 200) { edges { node { id name customerName personId } } } }`,
                { since },
              )
            ).appointments,
          ).map((row): Candidate => ({ source: 'APPOINTMENT', sourceId: row.id, personId: row.personId, name: row.customerName || row.name })),
        )
      : Promise.resolve([] as Candidate[]),
    settings.afterPaidInvoices
      ? optional(async () =>
          nodes(
            (
              await gql<{ invoices: { edges: { node: { id: string; invoiceNumber: string; personId: string | null } }[] } }>(
                `query($since: DateTime!) { invoices(filter: { status: { eq: PAID }, updatedAt: { gt: $since } }, first: 200) { edges { node { id invoiceNumber personId } } } }`,
                { since },
              )
            ).invoices,
          ).map((row): Candidate => ({ source: 'INVOICE', sourceId: row.id, personId: row.personId, name: `Invoice ${row.invoiceNumber}` })),
        )
      : Promise.resolve([] as Candidate[]),
  ]);
  return [...appointments, ...invoices];
};

const requestsFor = async (filter: Record<string, unknown>) =>
  nodes(
    (
      await gql<{ feedbackRequests: { edges: { node: { id: string } }[] } }>(`query($filter: FeedbackRequestFilterInput!) { feedbackRequests(filter: $filter, first: 1) { edges { node { id } } } }`, {
        filter,
      })
    ).feedbackRequests,
  );

export const createRequest = async (candidate: Candidate, settings: FeedbackSettings, now: number, sendAt = now + (settings.delayHours ?? 2) * HOUR) => {
  const { createFeedbackRequest } = await gql<{ createFeedbackRequest: { id: string } }>(
    `mutation($data: FeedbackRequestCreateInput!) { createFeedbackRequest(data: $data) { id } }`,
    {
      data: {
        name: candidate.name || 'Feedback',
        status: 'SCHEDULED',
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

// One request per source record, and nobody is asked more often than the cool-down allows.
export const scheduleNewRequests = async (settings: FeedbackSettings, now: number) => {
  // The first run only remembers where it started, so customers from before the app was switched on are not asked.
  if (!settings.lastScannedAt) {
    await updateSettings(settings.id, { lastScannedAt: new Date(now).toISOString() });
    return 0;
  }
  const candidates = await findCandidates(settings, settings.lastScannedAt);
  let created = 0;
  for (const candidate of candidates) {
    if (!candidate.personId) continue;
    if ((await requestsFor({ sourceId: { eq: candidate.sourceId } })).length > 0) continue;
    const cooldownStart = new Date(now - (settings.cooldownDays ?? 60) * DAY).toISOString();
    if ((await requestsFor({ personId: { eq: candidate.personId }, createdAt: { gte: cooldownStart } })).length > 0) continue;
    await createRequest(candidate, settings, now);
    created += 1;
  }
  await updateSettings(settings.id, { lastScannedAt: new Date(now).toISOString() });
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

export const sendRequest = async (request: FeedbackRequest, settings: FeedbackSettings, base: string, now: number) => {
  const person = request.personId ? await loadPerson(request.personId) : null;
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
    await updateRequest(request.id, { status: 'SENT', sentAt: new Date(now).toISOString(), expiresAt, recipient: sentTo.join(', '), error: problems.join('; ') });
    return 'SENT';
  }
  const reason = problems.length > 0 ? problems.join('; ') : wantsWhatsApp && !wantsEmail ? 'No mobile number with WhatsApp consent.' : 'No email address.';
  await updateRequest(request.id, { status: problems.length > 0 ? 'FAILED' : 'SKIPPED', error: reason });
  return problems.length > 0 ? 'FAILED' : 'SKIPPED';
};

export const sendDueRequests = async (settings: FeedbackSettings, base: string, now: number) => {
  const due = nodes(
    (
      await gql<{ feedbackRequests: { edges: { node: FeedbackRequest }[] } }>(
        `query($now: DateTime!) { feedbackRequests(filter: { status: { eq: SCHEDULED }, sendAt: { lte: $now } }, first: 100) { edges { node { ${REQUEST_FIELDS} } } } }`,
        { now: new Date(now).toISOString() },
      )
    ).feedbackRequests,
  );
  let sent = 0;
  for (const request of due) if ((await sendRequest(request, settings, base, now)) === 'SENT') sent += 1;
  return sent;
};

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
