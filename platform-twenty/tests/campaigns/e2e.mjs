// Campaign Studio end to end on the throwaway test server, against mock-resend.mjs (Resend and the WhatsApp gateway).
// Needs the app installed in the acme workspace with the variables from campaigns-test-vars.env.
// Usage: SERVER_URL=http://localhost:3001 node e2e.mjs <api key file> <variables env file>
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const SERVER_URL = process.env.SERVER_URL;
if (!SERVER_URL) throw new Error('Set SERVER_URL to the test server. Never run this against production.');
const MOCK = process.env.RESEND_MOCK_URL || 'http://127.0.0.1:8097';
const APP_ID = '992fae47-c2c3-4731-b8aa-ebdcdb466631';
const [keyFile, varsFile] = process.argv.slice(2);
const apiKey = readFileSync(keyFile, 'utf8').trim();
const vars = Object.fromEntries(readFileSync(varsFile, 'utf8').split('\n').filter(Boolean).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const W = SERVER_URL.replace('//localhost', '//acme.localhost');
const OTHER = SERVER_URL.replace('//localhost', '//glow.localhost');
const origin = new URL(W).origin;
const run = Date.now().toString(36);

let failures = 0;
let passes = 0;
const assert = (label, condition, detail = '') => {
  if (condition) passes += 1;
  else failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'} ${label}${condition ? '' : `  (${detail})`}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (label, check, timeout = 60_000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await check().catch(() => null);
    if (value) return value;
    await sleep(1500);
  }
  throw new Error(`timed out waiting for ${label}`);
};

const call = async (url, token, query, variables = {}) => {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) });
  const payload = await response.json();
  if (payload.errors) throw new Error(JSON.stringify(payload.errors.map((error) => error.message)));
  return payload.data;
};
const gql = (query, variables) => call(`${SERVER_URL}/graphql`, apiKey, query, variables);
const loginToken = (await call(`${W}/metadata`, null, `mutation($email: String!, $password: String!, $origin: String!) { getLoginTokenFromCredentials(email: $email, password: $password, origin: $origin) { loginToken { token } } }`, { email: 'admin@inventiveweb.test', password: 'Admin-Pass-1234!', origin })).getLoginTokenFromCredentials.loginToken.token;
const userToken = (await call(`${W}/metadata`, null, `mutation($loginToken: String!, $origin: String!) { getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) { tokens { accessOrWorkspaceAgnosticToken { token } } } }`, { loginToken, origin })).getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken.token;
const applicationId = (await call(`${W}/metadata`, userToken, `{ findManyApplications { id universalIdentifier } }`)).findManyApplications.find((app) => app.universalIdentifier === APP_ID).id;
const workspaceId = (await call(`${W}/metadata`, userToken, `{ currentWorkspace { id } }`)).currentWorkspace.id;

const mock = async (path, body) => (await fetch(`${MOCK}${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})).json();
const admin = async (body) => {
  const response = await fetch(`${W}/s/campaigns/admin`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
};
const runJob = () => fetch(`${W}/s/campaigns/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` }, body: '{}' }).then((response) => response.json().catch(() => null));

const workspaceKey = createHmac('sha256', vars.CAMPAIGN_LINK_SECRET).update(`workspace:${workspaceId}`).digest();
const webhookUrl = `${W}/s/campaigns/webhook/${createHmac('sha256', workspaceKey).update('resend-webhook').digest('base64url').slice(0, 32)}`;
// Resend echoes the tags we sent with each email back in its events.
const resendEvent = async (type, emailId, data = {}) => {
  const tags = Object.fromEntries(((await mock('/admin/emails')).find((email) => email.id === emailId)?.tags ?? []).map((tag) => [tag.name, tag.value]));
  return fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, created_at: new Date().toISOString(), data: { email_id: emailId, tags, ...data } }) });
};

await mock('/admin/reset', {});

// Contacts: three can be emailed, the rest must be skipped for a reason.
const domain = `c${run}.test`;
const people = [
  { key: 'ann', firstName: 'Ann', email: `ann@${domain}`, consent: true, whatsapp: true, phone: '7700900111' },
  { key: 'ben', firstName: 'Ben', email: `ben@${domain}`, consent: true },
  { key: 'cat', firstName: 'Cat', email: `cat@${domain}`, consent: true },
  { key: 'nope', firstName: 'Nope', email: `nope@${domain}`, consent: false, whatsapp: true, phone: '7700900222' },
  { key: 'blocked', firstName: 'Blocked', email: `blocked@${domain}`, consent: true },
  { key: 'reject', firstName: 'Reject', email: `reject@${domain}`, consent: true },
  { key: 'empty', firstName: 'Empty', email: '', consent: true },
];
const ids = {};
for (const person of people) {
  const { createPerson } = await gql(`mutation($data: PersonCreateInput!) { createPerson(data: $data) { id } }`, {
    data: {
      name: { firstName: person.firstName, lastName: run },
      emails: { primaryEmail: person.email },
      emailMarketingConsent: person.consent,
      whatsappMarketingConsent: Boolean(person.whatsapp && person.consent),
      ...(person.phone ? { phones: { primaryPhoneNumber: person.phone, primaryPhoneCallingCode: '+44', primaryPhoneCountryCode: 'GB' } } : {}),
    },
  });
  ids[person.key] = createPerson.id;
}
await gql(`mutation($data: CampaignSuppressionCreateInput!) { createCampaignSuppression(data: $data) { id } }`, { data: { name: 'blocked', destination: `blocked@${domain}`, channel: 'EMAIL', reason: 'MANUAL' } });

// 1. Connecting Resend: a sending-only or wrong key connects nothing; a full-access key connects.
const connect = async (secretKey) => {
  const { generateTransientToken } = await call(`${W}/metadata`, userToken, `mutation { generateTransientToken { transientToken { token } } }`);
  const authorize = await fetch(`${SERVER_URL}/auth/apps/authorize?${new URLSearchParams({ applicationId, providerName: 'resend-campaigns', transientToken: generateTransientToken.transientToken.token })}`, { redirect: 'manual' });
  const page = await fetch(authorize.headers.get('location'));
  const html = await page.text();
  const action = /<form[^>]* action="([^"]+)"/.exec(html)?.[1]?.replace(/&#38;/g, '&');
  await fetch(action, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ secretKey }), redirect: 'manual' });
  const status = await (await fetch(`${W}/s/campaigns/connect-status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fingerprint: createHash('sha256').update(secretKey).digest('hex').slice(0, 16) }) })).json();
  return { pageStatus: page.status, connected: status.connected };
};
const foreign = await fetch(`${W}/s/campaigns/connect?callback=${encodeURIComponent('https://evil.example/auth/apps/custom/callback?state=x')}`);
assert('the connect page refuses a callback that is not Twenty’s own', foreign.status === 400, String(foreign.status));
const bad = await connect(`re_sendonly_${run}abcdefghij`);
assert('a key Resend refuses is not connected', bad.pageStatus === 200 && bad.connected === false, JSON.stringify(bad));
const good = await connect(`re_good_${run}abcdefghij`);
assert('a full-access Resend key connects', good.connected === true, JSON.stringify(good));

const overview = (await admin({ action: 'overview' })).body;
assert('the studio sees the account and its verified domain', overview?.resend.connected && overview.resend.domains.some((entry) => entry.name === 'acme-mail.test' && entry.status === 'verified'), JSON.stringify(overview?.resend));

// 2. Brand kit, list and draft.
await admin({ action: 'updateBrand', changes: { name: 'Acme', footerText: 'Acme Ltd\n1 High Street, London', primaryColor: '#123456' } });
const badColour = await admin({ action: 'updateBrand', changes: { primaryColor: 'red;x' } });
assert('a brand colour must be a hex colour', badColour.status === 400, String(badColour.status));
const list = (await admin({ action: 'createList', name: `Newsletter ${run}` })).body;
const added = (await admin({ action: 'addToList', listId: list.id, personIds: Object.values(ids) })).body;
const again = (await admin({ action: 'addToList', listId: list.id, personIds: [ids.ann] })).body;
assert('contacts are added to a list once', added?.added === people.length && again?.added === 0 && again.total === people.length, `${JSON.stringify(added)} ${JSON.stringify(again)}`);

const draft = (await admin({ action: 'createDraft', channel: 'EMAIL', templateId: 'starter:newsletter', name: `Newsletter ${run}` })).body;
const design = {
  version: 1,
  blocks: [
    { id: 'h', type: 'heading', text: 'Hello {{firstName|there}}', level: 1 },
    { id: 't', type: 'text', text: 'News for **you**. <script>alert(1)</script>' },
    { id: 'b', type: 'button', label: 'Read more', url: 'https://acme.example/news' },
    { id: 'x', type: 'button', label: 'Bad', url: 'javascript:alert(1)' },
  ],
};
await admin({ action: 'saveDraft', id: draft.id, changes: { subject: 'News for {{firstName}}', previewText: 'This month', fromName: 'Acme', fromLocalPart: 'news', fromDomain: 'pending.test', listId: list.id, design } });
const checksPending = (await admin({ action: 'checks', id: draft.id })).body;
assert('an unverified domain and a bad button link block sending', checksPending?.problems.some((problem) => /not verified/.test(problem)) && checksPending.problems.some((problem) => /button/.test(problem)), JSON.stringify(checksPending));
design.blocks = design.blocks.filter((block) => block.id !== 'x');
await admin({ action: 'saveDraft', id: draft.id, changes: { fromDomain: 'acme-mail.test', design } });
const checks = (await admin({ action: 'checks', id: draft.id })).body;
assert('with a verified domain and valid content the checklist is clear', checks?.problems.length === 0, JSON.stringify(checks));

// 3. Test send.
const test = await admin({ action: 'testSend', id: draft.id, to: 'tester@acme.example' });
const testMail = (await mock('/admin/emails')).find((email) => email.to.includes('tester@acme.example'));
assert('a test send arrives marked as a test', test.status === 200 && testMail?.subject === '[Test] News for Alex', `${test.status} ${testMail?.subject}`);
const tooMany = await admin({ action: 'testSend', id: draft.id, to: 'a@x.co,b@x.co,c@x.co,d@x.co,e@x.co,f@x.co' });
assert('test sends are limited to five addresses', tooMany.status === 400, String(tooMany.status));

// 4. Send. The batch with the rejected address falls back to one-by-one sending.
const scheduled = await admin({ action: 'schedule', id: draft.id });
assert('a ready draft can be sent', scheduled.status === 200, JSON.stringify(scheduled.body));
const locked = await admin({ action: 'saveDraft', id: draft.id, changes: { subject: 'changed' } });
assert('a scheduled campaign cannot be edited', locked.status === 400, String(locked.status));
await runJob();
const getCampaign = async (id) => (await gql(`query($id: UUID!) { marketingCampaign(filter: { id: { eq: $id } }) { id status lastError recipientCount sentCount deliveredCount openedCount clickedCount bouncedCount complainedCount unsubscribedCount failedCount skippedCount } }`, { id })).marketingCampaign;
const sent = await waitFor('campaign sent', async () => {
  const campaign = await getCampaign(draft.id);
  if (campaign.status === 'SENDING') await runJob();
  return campaign.status === 'SENT' ? campaign : null;
}, 120_000).catch(async () => getCampaign(draft.id));
assert('the campaign finishes', sent.status === 'SENT', JSON.stringify(sent));
assert('only consenting, reachable contacts not on the do-not-contact list get it', sent.recipientCount === 4 && sent.skippedCount === 3 && sent.sentCount === 3 && sent.failedCount === 1, JSON.stringify(sent));

const delivered = (await mock('/admin/emails')).filter((email) => email.tags?.some((tag) => tag.name === 'campaign' && tag.value === draft.id));
const annMail = delivered.find((email) => email.to[0] === `ann@${domain}`);
assert('each contact gets their own email, once', delivered.length === 3 && new Set(delivered.map((email) => email.to[0])).size === 3 && !delivered.some((email) => /nope|blocked|reject/.test(email.to[0])), delivered.map((email) => email.to[0]).join(', '));
assert('the email is personalised and escaped', annMail?.subject === 'News for Ann' && annMail.html.includes('Hello Ann') && !annMail.html.includes('<script>') && annMail.from === '"Acme" <news@acme-mail.test>', annMail?.subject);
const unsubscribeLink = annMail?.headers['List-Unsubscribe']?.slice(1, -1) ?? '';
assert('the email carries one-click unsubscribe headers and the footer', annMail?.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click' && unsubscribeLink.startsWith(`${W}/s/campaigns/unsubscribe/`) && annMail.html.includes('1 High Street, London') && annMail.text.includes(unsubscribeLink), annMail?.headers['List-Unsubscribe']);
const batchCalls = (await mock('/admin/log')).filter((entry) => entry.path === '/emails/batch');
assert('batches are sent with an idempotency key', batchCalls.length > 0 && batchCalls.every((entry) => entry.idempotencyKey?.startsWith(`${draft.id}:`)), JSON.stringify(batchCalls));

// 5. Webhook events.
const messageFor = (address) => delivered.find((email) => email.to[0] === address)?.id;
const wrongToken = await fetch(webhookUrl.replace(/\/[^/]+$/, '/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'email.delivered', data: { email_id: messageFor(`ann@${domain}`) } }) });
assert('the webhook refuses calls without its secret token', wrongToken.status === 404, String(wrongToken.status));
const results = [];
results.push(await resendEvent('email.delivered', messageFor(`ann@${domain}`)));
results.push(await resendEvent('email.opened', messageFor(`ann@${domain}`)));
results.push(await resendEvent('email.clicked', messageFor(`ann@${domain}`), { click: { link: 'https://acme.example/news' } }));
results.push(await resendEvent('email.delivered', messageFor(`cat@${domain}`)));
results.push(await resendEvent('email.bounced', messageFor(`ben@${domain}`), { bounce: { type: 'Permanent', subType: 'General', message: 'No such mailbox' } }));
results.push(await resendEvent('email.complained', messageFor(`cat@${domain}`)));
assert('the webhook accepts Resend events', results.every((response) => response.status === 200), results.map((response) => response.status).join(','));
const suppressions = async () => (await gql(`query($like: String) { campaignSuppressions(filter: { destination: { like: $like } }) { edges { node { destination reason } } } }`, { like: `%@${domain}` })).campaignSuppressions.edges.map((edge) => edge.node);
const afterEvents = await suppressions();
const cat = (await gql(`query($id: UUID!) { person(filter: { id: { eq: $id } }) { emailMarketingConsent } }`, { id: ids.cat })).person;
assert('hard bounces and spam complaints go on the do-not-contact list', afterEvents.some((entry) => entry.destination === `ben@${domain}` && entry.reason === 'BOUNCED') && afterEvents.some((entry) => entry.destination === `cat@${domain}` && entry.reason === 'COMPLAINED'), JSON.stringify(afterEvents));
assert('a spam complaint withdraws consent', cat.emailMarketingConsent === false, JSON.stringify(cat));

// 6. Unsubscribe.
const otherWorkspace = await fetch(unsubscribeLink.replace(W, OTHER));
assert('an unsubscribe link does not work in another workspace', otherWorkspace.status === 404, String(otherWorkspace.status));
const tampered = await fetch(unsubscribeLink.replace(/.$/, (last) => (last === 'A' ? 'B' : 'A')));
assert('a tampered unsubscribe link is refused', tampered.status === 404, String(tampered.status));
const page = await fetch(unsubscribeLink);
const pageHtml = await page.text();
const stillSubscribed = (await gql(`query($id: UUID!) { person(filter: { id: { eq: $id } }) { emailMarketingConsent } }`, { id: ids.ann })).person.emailMarketingConsent;
assert('opening the link only shows a confirm button', page.status === 200 && /<button[^>]*>Unsubscribe</.test(pageHtml) && stillSubscribed === true, `${page.status} consent=${stillSubscribed}`);
const oneClick = await fetch(unsubscribeLink, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
const twice = await fetch(unsubscribeLink, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
const ann = (await gql(`query($id: UUID!) { person(filter: { id: { eq: $id } }) { emailMarketingConsent } }`, { id: ids.ann })).person;
assert('one-click unsubscribe works, twice is harmless, and consent is withdrawn', oneClick.status === 200 && twice.status === 200 && ann.emailMarketingConsent === false && (await suppressions()).some((entry) => entry.destination === `ann@${domain}` && entry.reason === 'UNSUBSCRIBED'), `${oneClick.status} ${twice.status} ${JSON.stringify(ann)}`);

await runJob();
const report = (await admin({ action: 'report', id: draft.id })).body;
const counts = report?.campaign.counts ?? {};
assert('the report counts deliveries, opens, clicks, bounces, complaints and unsubscribes', counts.deliveredCount === 2 && counts.openedCount === 1 && counts.clickedCount === 1 && counts.bouncedCount === 1 && counts.complainedCount === 1 && counts.unsubscribedCount === 1, JSON.stringify(counts));
assert('the report lists the failed and bounced addresses', report?.problems.some((problem) => problem.address === `reject@${domain}` && problem.status === 'FAILED') && report.problems.some((problem) => problem.address === `ben@${domain}`), JSON.stringify(report?.problems));

// 7. A second campaign skips everyone who left, survives a rate limit, and re-checks consent before each batch.
const second = (await admin({ action: 'duplicate', id: draft.id })).body;
// Domain checks: scheduling, the job's start check, then the one right before sending, which is made to fail.
await mock('/admin/fail-next', { path: '/domains', skip: 2 });
await admin({ action: 'schedule', id: second.id });
await runJob();
const paused = await getCampaign(second.id);
assert('a rate limit pauses sending instead of failing', paused.status === 'SENDING' && /slow down/.test(paused.lastError ?? ''), JSON.stringify(paused));
await gql(`mutation($id: UUID!) { updatePerson(id: $id, data: { emailMarketingConsent: false }) { id } }`, { id: ids.reject });
await runJob();
const secondDone = await waitFor('second campaign', async () => {
  const campaign = await getCampaign(second.id);
  if (campaign.status === 'SENDING' || campaign.status === 'PREPARING') await runJob();
  return campaign.status === 'SENT' ? campaign : null;
}, 90_000).catch(() => getCampaign(second.id));
const secondMails = (await mock('/admin/emails')).filter((email) => email.tags?.some((tag) => tag.name === 'campaign' && tag.value === second.id)).map((email) => email.to[0]);
const rejectRow = (await gql(`query($campaign: UUID, $person: UUID) { campaignRecipients(filter: { campaignId: { eq: $campaign }, personId: { eq: $person } }) { edges { node { status error } } } }`, { campaign: second.id, person: ids.reject })).campaignRecipients.edges[0]?.node;
assert('unsubscribed, bounced and complaining contacts are not emailed again', secondDone.status === 'SENT' && secondMails.length === 0 && secondDone.skippedCount === people.length, `${JSON.stringify(secondDone)} ${secondMails.join(',')}`);
assert('consent withdrawn while a campaign waits is respected', rejectRow?.status === 'SKIPPED' && /Withdrew consent/.test(rejectRow.error ?? ''), JSON.stringify(rejectRow));

// 7b. Two runs started at the same moment send each email once.
const fresh = [];
for (const name of ['Dee', 'Eve', 'Fay']) {
  const { createPerson } = await gql(`mutation($data: PersonCreateInput!) { createPerson(data: $data) { id } }`, { data: { name: { firstName: name, lastName: run }, emails: { primaryEmail: `${name.toLowerCase()}@${domain}` }, emailMarketingConsent: true } });
  fresh.push(createPerson.id);
}
const raceList = (await admin({ action: 'createList', name: `Race ${run}` })).body;
await admin({ action: 'addToList', listId: raceList.id, personIds: fresh });
const third = (await admin({ action: 'duplicate', id: draft.id })).body;
await admin({ action: 'saveDraft', id: third.id, changes: { listId: raceList.id } });
await admin({ action: 'schedule', id: third.id });
await mock('/admin/fail-next', { path: '/emails/batch' });
await Promise.all([runJob(), runJob(), runJob()]);
const midway = await getCampaign(third.id);
const thirdDone = await waitFor('third campaign', async () => {
  const campaign = await getCampaign(third.id);
  if (campaign.status === 'SENDING' || campaign.status === 'PREPARING') await runJob();
  return campaign.status === 'SENT' ? campaign : null;
}, 90_000).catch(() => getCampaign(third.id));
const thirdMails = (await mock('/admin/emails')).filter((email) => email.tags?.some((tag) => tag.name === 'campaign' && tag.value === third.id)).map((email) => email.to[0]);

const thirdBatchKeys = (await mock('/admin/log')).filter((entry) => entry.path === '/emails/batch' && entry.idempotencyKey?.startsWith(`${third.id}:`)).map((entry) => entry.idempotencyKey);
assert('a batch cut off by a rate limit is retried with the same idempotency key', thirdBatchKeys.length >= 2 && new Set(thirdBatchKeys).size === 1 && ['SENDING', 'SENT'].includes(midway.status), `${midway.status} ${JSON.stringify(thirdBatchKeys)}`);
assert('parallel job runs never send an email twice', thirdDone.status === 'SENT' && thirdMails.length === 3 && new Set(thirdMails).size === 3 && thirdDone.recipientCount === 3, `${JSON.stringify(thirdDone)} ${thirdMails.join(',')}`);

// 7c. Unscheduling returns a campaign to draft; a draft cannot be scheduled twice at once.
const fourth = (await admin({ action: 'duplicate', id: draft.id })).body;
await admin({ action: 'saveDraft', id: fourth.id, changes: { listId: raceList.id } });
const later = new Date(Date.now() + 86_400_000).toISOString();
const [firstSchedule, secondSchedule] = await Promise.all([admin({ action: 'schedule', id: fourth.id, sendAt: later }), admin({ action: 'schedule', id: fourth.id, sendAt: later })]);
const unscheduled = await admin({ action: 'cancel', id: fourth.id });
const afterCancel = await getCampaign(fourth.id);
assert('unscheduling returns the campaign to draft', [firstSchedule.status, secondSchedule.status].includes(200) && unscheduled.status === 200 && afterCancel.status === 'DRAFT', `${firstSchedule.status} ${secondSchedule.status} ${afterCancel.status}`);

// 8. WhatsApp campaign through the gateway.
const whatsappDraft = (await admin({ action: 'createDraft', channel: 'WHATSAPP', name: `WhatsApp ${run}` })).body;
await admin({ action: 'saveDraft', id: whatsappDraft.id, changes: { whatsappTemplate: 'spring_offer', whatsappVariables: { language: 'en_GB', 1: '{{firstName}}', 2: '20%' }, listId: list.id } });
const whatsappSchedule = await admin({ action: 'schedule', id: whatsappDraft.id });
await runJob();
const whatsappDone = await waitFor('whatsapp campaign', async () => {
  const campaign = await getCampaign(whatsappDraft.id);
  if (campaign.status === 'SENDING') await runJob();
  return campaign.status === 'SENT' ? campaign : null;
}, 90_000).catch(() => getCampaign(whatsappDraft.id));
const handoff = (await mock('/admin/whatsapp')).find((entry) => entry.campaignId === whatsappDraft.id);
assert('a WhatsApp campaign goes only to contacts who agreed to WhatsApp, signed, with filled values', whatsappSchedule.status === 200 && whatsappDone.status === 'SENT' && handoff?.event === 'campaign.message' && handoff.messages.length === 1 && handoff.messages[0].to === '+447700900111' && handoff.messages[0].variables.join('|') === 'Ann|20%' && handoff.template.language === 'en_GB', `${JSON.stringify(whatsappDone)} ${JSON.stringify(handoff)}`);
const statusBody = JSON.stringify({ recipientId: handoff?.messages[0].recipientId, status: 'delivered' });
const timestamp = Math.floor(Date.now() / 1000).toString();
const signature = `sha256=${createHmac('sha256', vars.WHATSAPP_GATEWAY_SECRET).update(`${timestamp}.${statusBody}`).digest('hex')}`;
const unsigned = await fetch(`${W}/s/campaigns/whatsapp/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: statusBody });
const signed = await fetch(`${W}/s/campaigns/whatsapp/status`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-InventiveCRM-Timestamp': timestamp, 'X-InventiveCRM-Signature': signature }, body: statusBody });
assert('WhatsApp status updates must be signed', unsigned.status === 401 && signed.status === 200, `${unsigned.status} ${signed.status}`);

await mock('/admin/reset', {});
console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
