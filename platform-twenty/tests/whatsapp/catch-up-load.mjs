// Catch-up across several workspaces on the throwaway test server, each connected as its own InventiveChat account on
// the shared double. The test server and worker are stopped while every account gets a backlog (so the webhooks really
// fail), then started again; the scheduled run must drain every feed. Reports drain times, feed request rates and CPU,
// and checks that nothing was lost. Twenty allows 5 workspaces per server without an organization key.
// Usage: SERVER_URL=http://localhost:3001 node catch-up-load.mjs <keys dir> <customers each> <subdomain[=key name]>...
// Needs mock-inventivechat.mjs running on 8098 as the app's INVENTIVECHAT_API_URL, and the stack in TEST_STACK_DIR.
// LOAD_TIMEOUT_MINUTES (default 20) bounds the wait; NEIGHBOUR_HEALTH_URL, if set, is timed during the drain to show
// what another stack on the same machine feels (only its /healthz is called).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { testServerUrl } from '../guard.cjs';

const SERVER_URL = testServerUrl();
const MOCK = process.env.INVENTIVECHAT_MOCK_URL || 'http://127.0.0.1:8098';
const STACK = process.env.TEST_STACK_DIR || '/opt/inventivecrm-test';
const APP_ID = '23e5cd3d-e631-461b-9e06-849c0a577688';
const EMAIL = 'admin@inventiveweb.test';
const PASSWORD = 'Admin-Pass-1234!';
const [keysDir, customerCount, ...names] = process.argv.slice(2);
if (!keysDir || !customerCount || names.length === 0) throw new Error('Usage: node catch-up-load.mjs <keys dir> <customers each> <subdomain[=key name]>...');
const WORKSPACES = names.length;
const CUSTOMERS = Number(customerCount);
const TIMEOUT_MS = Number(process.env.LOAD_TIMEOUT_MINUTES ?? 20) * 60_000;
const NEIGHBOUR = process.env.NEIGHBOUR_HEALTH_URL;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (line) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);
const pad = (value, length) => String(value).padStart(length, '0');
const baseOf = (subdomain) => SERVER_URL.replace('//localhost', `//${subdomain}.localhost`);

const post = async (url, body, token) => {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: new URL(url).origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (payload.errors) throw new Error(JSON.stringify(payload.errors.map((error) => error.message)));
  return payload.data;
};
const mock = async (path, body) => (await fetch(`${MOCK}${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})).json();

const signIn = async (base) => {
  const origin = new URL(base).origin;
  const loginToken = (await post(`${base}/metadata`, { query: `mutation($email: String!, $password: String!, $origin: String!) { getLoginTokenFromCredentials(email: $email, password: $password, origin: $origin) { loginToken { token } } }`, variables: { email: EMAIL, password: PASSWORD, origin } })).getLoginTokenFromCredentials.loginToken.token;
  return (await post(`${base}/metadata`, { query: `mutation($loginToken: String!, $origin: String!) { getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) { tokens { accessOrWorkspaceAgnosticToken { token } } } }`, variables: { loginToken, origin } })).getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken.token;
};

// Installs the latest published version, or upgrades to it: private apps do not upgrade on their own.
const install = async (base, token) => {
  const { jobId } = (await post(`${base}/metadata`, { query: 'mutation($input: TriggerInstallApplicationInput!) { triggerInstallApplication(input: $input) { jobId } }', variables: { input: { universalIdentifier: APP_ID } } }, token)).triggerInstallApplication;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(3000);
    const status = (await post(`${base}/metadata`, { query: 'query($id: String!, $job: String!) { findInstallApplicationJobStatus(universalIdentifier: $id, jobId: $job) { state failedReason } }', variables: { id: APP_ID, job: jobId } }, token)).findInstallApplicationJobStatus;
    if (/fail/i.test(status.state) && !/already installed/.test(status.failedReason ?? '')) throw new Error(`install failed in ${base}: ${status.failedReason}`);
    if (/complete|fail/i.test(status.state)) return (await post(`${base}/metadata`, { query: '{ findManyApplications { id universalIdentifier } }' }, token)).findManyApplications.find((app) => app.universalIdentifier === APP_ID).id;
  }
  throw new Error(`install timed out in ${base}`);
};

const connect = async (base, token, applicationId, secretKey) => {
  const { generateTransientToken } = await post(`${base}/metadata`, { query: 'mutation { generateTransientToken { transientToken { token } } }' }, token);
  const authorize = await fetch(`${SERVER_URL}/auth/apps/authorize?${new URLSearchParams({ applicationId, providerName: 'inventivechat', transientToken: generateTransientToken.transientToken.token })}`, { redirect: 'manual' });
  const html = await (await fetch(authorize.headers.get('location'))).text();
  const action = /<form[^>]* action="([^"]+)"/.exec(html)?.[1]?.replace(/&#38;/g, '&');
  await fetch(action, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ secretKey }), redirect: 'manual' });
};

const gql = (workspace, query, variables) => post(`${SERVER_URL}/graphql`, { query, variables }, workspace.apiKey);
const settingsOf = async (workspace) => (await gql(workspace, '{ whatsappSettingsRecords(orderBy: [{ createdAt: AscNullsLast }], first: 1) { edges { node { id tenantId eventCursor eventsCheckedAt eventsProblem } } } }')).whatsappSettingsRecords.edges[0]?.node;
const countsOf = async (workspace) => {
  const data = await gql(workspace, `query($from: DateTime) { conversations: whatsappConversations(filter: { createdAt: { gte: $from } }) { totalCount } messages: whatsappMessages(filter: { createdAt: { gte: $from } }) { totalCount } }`, { from: workspace.backlogFrom });
  return { conversations: data.conversations.totalCount, messages: data.messages.totalCount };
};

const compose = (...args) => execFileSync('docker', ['compose', ...args], { cwd: STACK, stdio: 'pipe' }).toString();
const healthy = async () => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await fetch(`${SERVER_URL}/healthz`).then((response) => response.ok).catch(() => false)) return;
    await sleep(2000);
  }
  throw new Error('the test server did not come back');
};

// 1. Workspaces, the app and a connection per workspace, each to its own InventiveChat account.
const workspaces = names.map((name, position) => {
  const [subdomain, keyName = subdomain] = name.split('=');
  const index = position + 1;
  return { index, subdomain, base: baseOf(subdomain), apiKey: readFileSync(`${keysDir}/${keyName}.key`, 'utf8').trim(), tenant: `ten_load${pad(index, 2)}` };
});
const setUp = async (workspace) => {
  const token = await signIn(workspace.base);
  const applicationId = await install(workspace.base, token);
  const key = `wa_test_load${pad(workspace.index, 2)}_${Date.now().toString(36)}abcdef`;
  await connect(workspace.base, token, applicationId, key);
  const settings = await settingsOf(workspace);
  if (settings?.tenantId !== workspace.tenant) throw new Error(`${workspace.subdomain} did not connect: ${JSON.stringify(settings)}`);
  // A feed position from an earlier run of the double means nothing to this one.
  const latest = (await (await fetch(`${MOCK}/v1/events/feed?after=latest`, { headers: { Authorization: `Bearer ${key}` } })).json()).next_cursor;
  await gql(workspace, 'mutation($id: UUID!, $data: WhatsappSettingsUpdateInput!) { updateWhatsappSettings(id: $id, data: $data) { id } }', { id: settings.id, data: { eventCursor: latest, eventsProblem: null } });
  log(`${workspace.subdomain} connected as ${workspace.tenant}`);
};
for (let start = 0; start < workspaces.length; start += 3) await Promise.all(workspaces.slice(start, start + 3).map(setUp));

// 2. The CRM goes down; every account gets customers writing in, and automation approved for each.
const seed = pad(Math.floor(Date.now() / 1000) % 1000, 3);
for (const workspace of workspaces) workspace.backlogFrom = new Date().toISOString();
log('stopping the test server and worker');
compose('stop', 'server', 'worker');
const outageStarted = Date.now();
let events = 0;
let delivered = 0;
await Promise.all(
  workspaces.map(async (workspace) => {
    for (let customer = 1; customer <= CUSTOMERS; customer += 1) {
      const phone = `+4477${pad(workspace.index, 2)}${seed}${pad(customer, 3)}`;
      const first = await mock('/admin/inbound', { tenant: workspace.tenant, phone, profileName: `Load ${workspace.index}-${customer}`, text: `Hello from ${customer}` });
      await mock('/admin/inbound', { tenant: workspace.tenant, phone, text: `Are you open today? ${customer}` });
      const approved = await mock('/admin/approve', { conversationId: first.conversationId });
      events += 3;
      delivered += [...first.results, ...approved.results].filter((result) => result.status === 200).length;
    }
  }),
);
log(`${events} events while the CRM was down; webhooks accepted: ${delivered}`);
compose('start', 'server', 'worker');
await healthy();
const backAt = Date.now();
log(`test server back after ${Math.round((backAt - outageStarted) / 1000)} s`);

// 3. Wait for the scheduled runs to drain every feed, sampling CPU meanwhile.
const cpu = [];
const neighbour = [];
let sampling = true;
const neighbourProbe = (async () => {
  while (NEIGHBOUR && sampling) {
    const started = Date.now();
    const ok = await fetch(NEIGHBOUR, { signal: AbortSignal.timeout(10_000) }).then((response) => response.ok).catch(() => false);
    neighbour.push({ ms: Date.now() - started, ok });
    await sleep(2000);
  }
})();
const sampler = (async () => {
  while (sampling) {
    const lines = execFileSync('docker', ['stats', '--no-stream', '--format', '{{.Name}} {{.CPUPerc}}', 'inventivecrm-test-server-1', 'inventivecrm-test-worker-1', 'inventivecrm-test-db-1']).toString().trim().split('\n');
    cpu.push({ at: Date.now(), ...Object.fromEntries(lines.map((line) => [line.split(' ')[0].replace('inventivecrm-test-', '').replace('-1', ''), Number.parseFloat(line.split(' ')[1])])) });
    await sleep(3000);
  }
})();
const done = new Map();
while (done.size < workspaces.length && Date.now() - backAt < TIMEOUT_MS) {
  for (const workspace of workspaces.filter((entry) => !done.has(entry.subdomain))) {
    const counts = await countsOf(workspace).catch(() => null);
    if (counts && counts.conversations >= CUSTOMERS && counts.messages >= 2 * CUSTOMERS) done.set(workspace.subdomain, { at: Date.now(), counts });
  }
  await sleep(5000);
}
sampling = false;
await sampler;
await neighbourProbe;

// 4. Results.
const feedRequests = (await mock('/admin/log')).filter((entry) => entry.path === '/v1/events/feed' && Date.parse(entry.at) >= backAt && /^ten_load/.test(entry.tenant ?? ''));
const perSecond = new Map();
for (const request of feedRequests) perSecond.set(request.at.slice(0, 19), (perSecond.get(request.at.slice(0, 19)) ?? 0) + 1);
const stats = (key) => {
  const values = cpu.map((sample) => sample[key]).filter(Number.isFinite);
  return { average: Math.round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)), peak: Math.round(Math.max(0, ...values)) };
};
const results = [];
for (const workspace of workspaces) {
  const finished = done.get(workspace.subdomain);
  const requests = feedRequests.filter((request) => request.tenant === workspace.tenant);
  const settings = await settingsOf(workspace);
  const counts = await countsOf(workspace);
  results.push({
    workspace: workspace.subdomain,
    complete: counts.conversations === CUSTOMERS && counts.messages === 2 * CUSTOMERS,
    counts,
    drainedAfterSeconds: finished ? Math.round((finished.at - backAt) / 1000) : null,
    firstFeedReadAfterSeconds: requests.length ? Math.round((Date.parse(requests[0].at) - backAt) / 1000) : null,
    feedRequests: requests.length,
    problem: settings?.eventsProblem ?? null,
  });
}
const summary = {
  workspaces: WORKSPACES,
  eventsPerWorkspace: 3 * CUSTOMERS,
  eventsInAll: events,
  webhooksAcceptedDuringOutage: delivered,
  everyWorkspaceComplete: results.every((result) => result.complete),
  slowestDrainSeconds: Math.max(...results.map((result) => result.drainedAfterSeconds ?? Number.POSITIVE_INFINITY)),
  feedRequests: feedRequests.length,
  peakFeedRequestsPerSecond: Math.max(0, ...perSecond.values()),
  cpuPercentOfOneCore: { server: stats('server'), worker: stats('worker'), db: stats('db'), samples: cpu.length },
  ...(NEIGHBOUR ? { neighbourHealth: { checks: neighbour.length, failed: neighbour.filter((check) => !check.ok).length, p50Ms: [...neighbour].sort((a, b) => a.ms - b.ms)[Math.floor(neighbour.length / 2)]?.ms ?? null, maxMs: Math.max(0, ...neighbour.map((check) => check.ms)) } } : {}),
  results,
};
console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.everyWorkspaceComplete ? 0 : 1;
