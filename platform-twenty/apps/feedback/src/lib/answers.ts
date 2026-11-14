import { gql, nodes } from 'src/lib/api';
import { isValidScore, reviewLinkFor, shouldAlert } from 'src/lib/nps';
import { type FeedbackRequest, REQUEST_FIELDS, updateRequest } from 'src/lib/requests';
import { sendAlertEmail } from 'src/lib/send';
import { loadSettings } from 'src/lib/settings';
import { parseSurveyToken, verifySurveyToken } from 'src/lib/tokens';

export class PublicError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');

export const requestFromToken = async (token: string) => {
  const parsed = parseSurveyToken(text(token, 120));
  if (!parsed) throw new PublicError(404, 'NOT_FOUND', 'This link is not valid.');
  const request = nodes(
    (
      await gql<{ feedbackRequests: { edges: { node: FeedbackRequest & { person: { name: { firstName: string } } | null } }[] } }>(
        `query($id: UUID!) { feedbackRequests(filter: { id: { eq: $id } }) { edges { node { ${REQUEST_FIELDS} person { name { firstName } } } } } }`,
        { id: parsed.requestId },
      )
    ).feedbackRequests,
  )[0];
  if (!request || !verifySurveyToken(token, request.nonce)) throw new PublicError(404, 'NOT_FOUND', 'This link is not valid.');
  return request;
};

const isOpen = (request: FeedbackRequest, now: number) =>
  (request.status === 'SENT' || request.status === 'ANSWERED') && (!request.expiresAt || Date.parse(request.expiresAt) > now);

export const surveyInfo = async (token: string) => {
  const request = await requestFromToken(token);
  const settings = await loadSettings();
  return {
    open: isOpen(request, Date.now()),
    businessName: settings?.businessName || '',
    question: settings?.question || 'How likely are you to recommend us to a friend or colleague?',
    firstName: request.person?.name?.firstName ?? '',
    score: request.score,
    comment: request.comment ?? '',
  };
};

const createFollowUpTask = async (request: FeedbackRequest, score: number, comment: string) => {
  const { createTask } = await gql<{ createTask: { id: string } }>(`mutation($data: TaskCreateInput!) { createTask(data: $data) { id } }`, {
    data: {
      title: `Follow up: feedback score ${score} from ${request.name}`,
      status: 'TODO',
      dueAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
      bodyV2: { markdown: `A customer gave a score of **${score}** out of 10.\n\n${comment ? `> ${comment.replace(/\n/g, '\n> ')}` : 'No comment was left.'}\n\nGet in touch while it is fresh.` },
    },
  });
  if (request.personId)
    await gql(`mutation($data: TaskTargetCreateInput!) { createTaskTarget(data: $data) { id } }`, { data: { taskId: createTask.id, targetPersonId: request.personId } });
  return createTask.id;
};

export const submitAnswer = async (body: Record<string, unknown>, now = Date.now()) => {
  const request = await requestFromToken(text(body.token, 120));
  if (!isOpen(request, now)) throw new PublicError(400, 'CLOSED', 'This survey is closed. Thank you for your time.');
  const score = Number(body.score);
  if (!isValidScore(score)) throw new PublicError(400, 'INVALID', 'Choose a score from 0 to 10.');
  const comment = text(body.comment, 2000).trim();
  const settings = await loadSettings();
  const firstAnswer = request.status !== 'ANSWERED';
  const reviewUrl = reviewLinkFor(score, settings?.promoterScore, settings?.googleReviewUrl);

  await updateRequest(request.id, { status: 'ANSWERED', score, comment, answeredAt: new Date(now).toISOString(), ...(reviewUrl ? { reviewLinkShown: true } : {}) });

  // Alerts go out once, on the first unhappy answer; changing the answer later does not repeat them.
  if (firstAnswer && shouldAlert(score, settings?.alertBelowScore) && !request.followUpTaskId) {
    const taskId = await createFollowUpTask(request, score, comment).catch(() => '');
    if (taskId) await updateRequest(request.id, { followUpTaskId: taskId });
    const to = (settings?.alertEmails ?? '')
      .split(',')
      .map((address) => address.trim())
      .filter((address) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
      .slice(0, 10);
    await sendAlertEmail({
      to,
      subject: `Unhappy customer: score ${score} from ${request.name}`,
      text: [`${request.name} gave a score of ${score} out of 10.`, '', comment ? `Comment: ${comment}` : 'No comment was left.', '', 'A follow-up task has been created in the CRM.'].join('\n'),
    }).catch(() => undefined);
  }
  return { thanks: true, reviewUrl };
};
