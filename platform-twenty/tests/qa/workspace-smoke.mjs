// After onboarding a workspace on the test server: every app's records are reachable, signed-in routes refuse API keys,
// public routes refuse bad input, and another workspace's key gets nothing here. Writes nothing.
// Usage: SERVER_URL=http://localhost:3001 node workspace-smoke.mjs <subdomain> <its api key file> <another workspace's api key file>
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SERVER_URL = require('../guard.cjs').testServerUrl();
const [subdomain, keyFile, otherKeyFile] = process.argv.slice(2);
if (!subdomain || !keyFile || !otherKeyFile) throw new Error('Usage: node workspace-smoke.mjs <subdomain> <api key file> <other workspace api key file>');
const key = readFileSync(keyFile, 'utf8').trim();
const otherKey = readFileSync(otherKeyFile, 'utf8').trim();
const W = SERVER_URL.replace('//localhost', `//${subdomain}.localhost`);

let failures = 0;
const assert = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` -- ${detail}`}`);
};
const post = async (path, body, token) => {
  const response = await fetch(`${W}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
};
const count = async (object, token = key) => {
  const { body } = await post('/graphql', { query: `{ ${object} { totalCount } }` }, token);
  return body?.data?.[object]?.totalCount ?? (body?.errors?.[0]?.message ?? 'no answer');
};

const OBJECTS = {
  Scheduling: ['appointments', 'appointmentTypes', 'advisors', 'slotReservations'],
  'Quotes & Invoices': ['invoices', 'quotes', 'products', 'businessProfiles'],
  'Campaign Studio': ['marketingCampaigns', 'campaignRecipients', 'campaignSuppressions'],
  Feedback: ['feedbackRequests'],
  'Team chat': ['chatChannels', 'chatMessages'],
  WhatsApp: ['whatsappConversations', 'whatsappMessages', 'whatsappSettingsRecords'],
};
for (const [app, objects] of Object.entries(OBJECTS)) {
  const counts = await Promise.all(objects.map((object) => count(object)));
  assert(`${app}: its records are reachable in ${subdomain}`, counts.every((value) => typeof value === 'number'), JSON.stringify(Object.fromEntries(objects.map((object, index) => [object, counts[index]]))));
}

const SIGNED_IN = [
  ['/s/scheduling/admin', { action: 'overview' }],
  ['/s/campaigns/admin', { action: 'overview' }],
  ['/s/feedback/admin', { action: 'overview' }],
  ['/s/chat/api', { action: 'bootstrap' }],
  ['/s/whatsapp/api', { action: 'templates' }],
];
for (const [path, body] of SIGNED_IN) {
  const { status } = await post(path, body, key);
  assert(`${path} refuses an API key (it would act with the app's full role)`, status === 403, String(status));
  const foreign = await post(path, body, otherKey);
  assert(`${path} refuses another workspace's key`, foreign.status === 401 || foreign.status === 403, String(foreign.status));
}

const PUBLIC = [
  ['/s/booking/api', { action: 'page', slug: 'no-such-type' }, (status) => status === 404],
  // A workspace that has not connected WhatsApp answers 503 and writes nothing.
  ['/s/whatsapp/events', { payload: {} }, (status) => status === 401 || status === 503],
  ['/s/whatsapp/gateway', { event: 'invoice.send' }, (status) => status === 401],
  ['/s/feedback/api', { action: 'info', token: 'not-a-token' }, (status) => status >= 400 && status < 500],
  ['/s/payments/connect-status', { provider: 'STRIPE', fingerprint: '0000000000000000' }, (status) => status === 200],
];
for (const [path, body, expected] of PUBLIC) {
  const { status, body: answer } = await post(path, body);
  assert(`${path} answers bad or unsigned input safely`, expected(status), `${status} ${JSON.stringify(answer).slice(0, 120)}`);
}
const connectStatus = await post('/s/payments/connect-status', { provider: 'STRIPE', fingerprint: '0000000000000000' });
assert('a guessed key fingerprint is not reported as connected', connectStatus.body?.connected === false, JSON.stringify(connectStatus.body));

const unsubscribe = await fetch(`${W}/s/campaigns/unsubscribe/not-a-token`);
assert('/s/campaigns/unsubscribe refuses a made-up link', unsubscribe.status >= 400 && unsubscribe.status < 500, String(unsubscribe.status));

console.log(`SUMMARY ${failures === 0 ? 'all passed' : `${failures} failed`}`);
process.exitCode = failures === 0 ? 0 : 1;
