import { asApplication, gql, nodes } from 'src/lib/api';
import { npsGroup, npsSummary } from 'src/lib/nps';
import { createRequest, type FeedbackRequest, REQUEST_FIELDS, sendRequest } from 'src/lib/requests';
import { publicBaseUrl } from 'src/lib/send';
import { ensureSettings } from 'src/lib/settings';

export class AdminError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const DAY = 24 * 3600_000;

type Answered = { id: string; name: string; score: number; comment: string; answeredAt: string; personId: string | null };

const overview = async () => {
  const settings = await asApplication(ensureSettings);
  const since = new Date(Date.now() - 90 * DAY).toISOString();
  const [answeredData, askedData] = await Promise.all([
    gql<{ feedbackRequests: { edges: { node: Answered }[] } }>(
      `query($since: DateTime!) { feedbackRequests(filter: { status: { eq: ANSWERED }, answeredAt: { gte: $since } }, orderBy: [{ answeredAt: DescNullsLast }], first: 1000) { edges { node { id name score comment answeredAt personId } } } }`,
      { since },
    ),
    gql<{ feedbackRequests: { totalCount: number } }>(
      `query($since: DateTime!) { feedbackRequests(filter: { status: { in: [SENT, ANSWERED, EXPIRED] }, sentAt: { gte: $since } }) { totalCount } }`,
      { since },
    ),
  ]);
  const answered = nodes(answeredData.feedbackRequests).filter((row) => row.score !== null);
  const summary = npsSummary(answered.map((row) => row.score));
  return {
    settings: {
      id: settings.id,
      enabled: settings.enabled,
      channel: settings.channel,
      afterAppointments: settings.afterAppointments,
      afterPaidInvoices: settings.afterPaidInvoices,
      hasReviewLink: Boolean(settings.googleReviewUrl),
      hasAlertEmails: Boolean(settings.alertEmails?.trim()),
    },
    summary,
    asked: askedData.feedbackRequests.totalCount,
    responseRate: askedData.feedbackRequests.totalCount > 0 ? Math.round((summary.total / askedData.feedbackRequests.totalCount) * 100) : null,
    recent: answered.slice(0, 12).map((row) => ({ id: row.id, name: row.name, score: row.score, group: npsGroup(row.score), comment: row.comment, answeredAt: row.answeredAt })),
  };
};

// Staff can ask one customer straight away, for example after a phone call.
const askNow = async (body: Record<string, unknown>) => {
  const personId = typeof body.personId === 'string' ? body.personId : '';
  if (!/^[0-9a-f-]{36}$/.test(personId)) throw new AdminError(400, 'Choose a customer.');
  const person = nodes(
    (await gql<{ people: { edges: { node: { id: string; name: { firstName: string; lastName: string } } }[] } }>(`query($id: UUID!) { people(filter: { id: { eq: $id } }) { edges { node { id name { firstName lastName } } } } }`, { id: personId }))
      .people,
  )[0];
  if (!person) throw new AdminError(404, 'That customer was not found.');
  return asApplication(async () => {
    const settings = await ensureSettings();
    const now = Date.now();
    const id = await createRequest({ source: 'MANUAL', sourceId: `manual:${person.id}:${now}`, personId: person.id, name: `${person.name.firstName} ${person.name.lastName}`.trim() }, settings, now, now);
    const request = nodes(
      (await gql<{ feedbackRequests: { edges: { node: FeedbackRequest }[] } }>(`query($id: UUID!) { feedbackRequests(filter: { id: { eq: $id } }) { edges { node { ${REQUEST_FIELDS} } } } }`, { id })).feedbackRequests,
    )[0];
    if (!request) throw new Error(`Feedback request ${id} was created but could not be read back.`);
    return { status: await sendRequest(request, settings, await publicBaseUrl(), now) };
  });
};

export const handleAdmin = async (body: Record<string, unknown>) => {
  switch (body.action) {
    case 'overview':
      return overview();
    case 'askNow':
      return askNow(body);
    default:
      throw new AdminError(400, 'Unknown action.');
  }
};
