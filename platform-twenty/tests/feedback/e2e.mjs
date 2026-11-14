// Feedback app end to end on the throwaway test server, using the Scheduling test world (completed appointments
// are the trigger). Never run it against production: it changes appointments and feedback settings.
// Usage: SERVER_URL=http://localhost:3001 node e2e.mjs <scheduling state file> <api key file>
import { readFileSync } from 'node:fs';

import { assert, keyClient, MAILPIT, mailTo, summary, userToken, waitFor } from '../scheduling/lib.mjs';

const [stateFile, keyFile] = process.argv.slice(2);
const state = JSON.parse(readFileSync(stateFile, 'utf8'));
const W = state.workspaceUrl;
const OTHER = W.replace('//acme.', '//glow.');
const api = keyClient(keyFile);
const token = await userToken(W, 'admin@inventiveweb.test', 'Admin-Pass-1234!');
const run = Date.now().toString(36);
const startedAt = Date.now();
const owner = `owner.${run}@acme.test`;

const post = async (base, path, body, auth = false) => {
  const response = await fetch(`${base}/s/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
};
const runJob = () => post(W, 'feedback/run', {}, true);
const requests = async () => (await api.gql(`{ feedbackRequests(first: 200, orderBy: [{ createdAt: DescNullsLast }]) { edges { node { id status sourceId personId score followUpTaskId reviewLinkShown recipient error } } } }`)).feedbackRequests.edges.map((edge) => edge.node);
const linkFrom = async (address) => {
  const message = await waitFor(`survey email to ${address}`, async () => (await mailTo(address, startedAt)).find((item) => /feedback/i.test(item.Subject)), 60000);
  const full = await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json();
  return { message: full, link: /https?:\/\/\S+\/s\/feedback\/[\w.-]+/.exec(full.Text)?.[0] ?? null };
};

// Settings are created switched off on first use.
const overview = await post(W, 'feedback/admin', { action: 'overview' }, true);
assert('the overview creates settings, switched off', overview.status === 200 && overview.body.settings.enabled === false, JSON.stringify(overview.body?.settings));
const settingsId = overview.body.settings.id;
await api.gql(`mutation($id: UUID!, $data: FeedbackSettingsUpdateInput!) { updateFeedbackSettings(id: $id, data: $data) { id } }`, {
  id: settingsId,
  data: { enabled: true, afterAppointments: true, afterPaidInvoices: false, delayHours: 0, cooldownDays: 60, channel: 'EMAIL', businessName: 'Acme Plumbing', alertEmails: owner, googleReviewUrl: 'https://g.page/r/acme-test/review', lastScannedAt: null },
});
const first = await runJob();
assert('the first run only remembers where it started, so earlier customers are not asked', first.status === 200 && (await requests()).every((request) => request.status !== 'SCHEDULED'), JSON.stringify(first.body));

// Two appointments with different customers become Completed.
const appointments = (await api.gql(`{ appointments(filter: { status: { in: [CONFIRMED, RESCHEDULED] }, personId: { is: NOT_NULL } }, first: 100) { edges { node { id personId customerEmail person { emails { primaryEmail } } } } } }`)).appointments.edges
  .map((edge) => edge.node)
  .filter((row) => row.person?.emails?.primaryEmail);
const byPerson = [...new Map(appointments.map((row) => [row.personId, row])).values()];
const [one, two] = byPerson;
const another = appointments.find((row) => row.personId === one.personId && row.id !== one.id);
for (const appointment of [one, two]) await api.gql(`mutation($id: UUID!) { updateAppointment(id: $id, data: { status: COMPLETED }) { id } }`, { id: appointment.id });
const second = await runJob();
const afterRun = await requests();
const oneRequest = afterRun.find((request) => request.sourceId === one.id);
const twoRequest = afterRun.find((request) => request.sourceId === two.id);
assert('completed appointments are picked up and their customers asked by email', oneRequest?.status === 'SENT' && twoRequest?.status === 'SENT', `${JSON.stringify(second.body)} ${oneRequest?.status}/${twoRequest?.status} ${oneRequest?.error ?? ''}`);

const mailOne = await linkFrom(one.person.emails.primaryEmail);
const mailTwo = await linkFrom(two.person.emails.primaryEmail);
assert('the email comes from the business via InventiveCRM and links every score', mailOne.message.From.Name === 'Acme Plumbing via InventiveCRM' && /score=10/.test(mailOne.message.HTML) && Boolean(mailOne.link), mailOne.message.From.Name);
const surveyToken = mailOne.link.split('/s/feedback/')[1];
const page = await fetch(mailOne.link);
const pageHtml = await page.text();
assert('the survey page opens without caching', page.status === 200 && page.headers.get('cache-control') === 'no-store' && pageHtml.includes('__SURVEY__'), `${page.status} ${page.headers.get('cache-control')}`);
const info = await post(W, 'feedback/api', { action: 'info', token: surveyToken });
assert('the survey shows the question and business', info.body?.open === true && info.body.businessName === 'Acme Plumbing', JSON.stringify(info.body));

// Wrong inputs and other workspaces are refused.
const badScore = await post(W, 'feedback/api', { action: 'answer', token: surveyToken, score: 11 });
const crossWorkspace = await post(OTHER, 'feedback/api', { action: 'info', token: surveyToken });
assert('an invalid score and a link used in another workspace are refused', badScore.status === 400 && crossWorkspace.status === 404, `${badScore.status} ${crossWorkspace.status}`);

// A low score creates a follow-up task and alerts the team; a high score gets the review link.
const low = await post(W, 'feedback/api', { action: 'answer', token: surveyToken, score: 3, comment: 'The engineer was late and did not call.' });
const lowRequest = (await requests()).find((request) => request.sourceId === one.id);
const task = lowRequest?.followUpTaskId ? (await api.gql(`query($id: UUID!) { tasks(filter: { id: { eq: $id } }) { edges { node { title taskTargets { edges { node { targetPersonId } } } } } } }`, { id: lowRequest.followUpTaskId })).tasks.edges[0]?.node : null;
const alert = await waitFor('alert email', async () => (await mailTo(owner, startedAt))[0], 30000).catch(() => null);
assert('a low score creates a follow-up task on the customer and emails the alert list', low.status === 200 && !low.body.reviewUrl && task?.taskTargets.edges[0]?.node.targetPersonId === one.personId && /score 3/.test(alert?.Subject ?? ''), `${task?.title} | ${alert?.Subject}`);
const high = await post(W, 'feedback/api', { action: 'answer', token: mailTwo.link.split('/s/feedback/')[1], score: 10, comment: 'Brilliant' });
assert('a high score is thanked with the Google review link', high.body?.reviewUrl === 'https://g.page/r/acme-test/review', JSON.stringify(high.body));
const changed = await post(W, 'feedback/api', { action: 'answer', token: surveyToken, score: 2 });
const alerts = (await mailTo(owner, startedAt)).length;
assert('changing an answer does not repeat the alert', changed.status === 200 && alerts === 1, `${alerts} alerts`);

// The same customer is not asked again inside the cool-down, and nothing is asked twice.
if (another) await api.gql(`mutation($id: UUID!) { updateAppointment(id: $id, data: { status: COMPLETED }) { id } }`, { id: another.id });
await runJob();
const final = await requests();
assert('the cool-down stops a second request to the same customer, and re-runs ask nobody twice', Boolean(another) && !final.some((request) => request.sourceId === another.id) && final.filter((request) => request.sourceId === one.id).length === 1, another ? `${final.length} requests` : 'the test world has no second appointment for this customer');

// Expired links are closed.
await api.gql(`mutation($id: UUID!) { updateFeedbackRequest(id: $id, data: { expiresAt: "2020-01-01T00:00:00.000Z" }) { id } }`, { id: lowRequest.id });
const expired = await post(W, 'feedback/api', { action: 'answer', token: surveyToken, score: 9 });
assert('an expired link no longer accepts answers', expired.status === 400 && expired.body?.error === 'CLOSED', `${expired.status} ${JSON.stringify(expired.body)}`);

const done = await post(W, 'feedback/admin', { action: 'overview' }, true);
assert('the overview reports the answers and NPS', done.body?.summary.total >= 2 && typeof done.body.summary.nps === 'number', JSON.stringify(done.body?.summary));

process.exit(summary() ? 0 : 1);
