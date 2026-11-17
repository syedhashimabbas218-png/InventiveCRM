// Response times of a few app routes on the throwaway test server: p50/p95/p99 per route, sequential and in parallel.
// Read-only apart from the rate-limit counters and read positions the routes keep themselves.
// Usage: SERVER_URL=http://localhost:3001 node tests/perf/latency.mjs <keys dir> [requests per route]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const SERVER_URL = require('../guard.cjs').testServerUrl();

const keysDir = process.argv[2];
const count = Number(process.argv[3] ?? 40);
if (!keysDir) throw new Error('Usage: SERVER_URL=... node tests/perf/latency.mjs <keys dir> [requests per route]');
const state = JSON.parse(readFileSync(join(keysDir, 'state.json'), 'utf8'));
const apiKey = readFileSync(join(keysDir, 'acme.key'), 'utf8').trim();
const W = state.workspaceUrl;
const origin = new URL(W).origin;

const post = async (url, body, headers = {}) => {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
};

const metadata = async (query, variables, token) => {
  const { payload } = await post(`${W}/metadata`, { query, variables }, { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) });
  if (payload?.errors?.length) throw new Error(payload.errors[0].message);
  return payload.data;
};

const signIn = async (email, password) => {
  const { getLoginTokenFromCredentials } = await metadata(`mutation($email: String!, $password: String!, $origin: String!) { getLoginTokenFromCredentials(email: $email, password: $password, origin: $origin) { loginToken { token } } }`, { email, password, origin });
  const { getAuthTokensFromLoginToken } = await metadata(`mutation($loginToken: String!, $origin: String!) { getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) { tokens { accessOrWorkspaceAgnosticToken { token } } } }`, { loginToken: getLoginTokenFromCredentials.loginToken.token, origin });
  return getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken.token;
};

const percentile = (sorted, share) => sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)];

// Each request gets its own client address, so the app's per-client limits measure nothing but the route itself.
let client = 0;
const forwardedFor = () => ({ 'X-Forwarded-For': `198.51.100.${(client++ % 250) + 1}` });

const measure = async (name, request, parallel = 1) => {
  const durations = [];
  const failures = new Map();
  let next = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: parallel }, async () => {
      while (next < count) {
        next += 1;
        const begin = performance.now();
        const { status } = await request();
        durations.push(performance.now() - begin);
        if (status !== 200) failures.set(status, (failures.get(status) ?? 0) + 1);
      }
    }),
  );
  const seconds = (performance.now() - started) / 1000;
  const sorted = durations.sort((first, second) => first - second);
  const round = (value) => Math.round(value);
  console.log(
    [name.padEnd(34), `x${parallel}`.padEnd(4), `p50 ${round(percentile(sorted, 0.5))}`.padEnd(10), `p95 ${round(percentile(sorted, 0.95))}`.padEnd(10), `p99 ${round(percentile(sorted, 0.99))}`.padEnd(10), `max ${round(sorted.at(-1))}`.padEnd(10), `${(count / seconds).toFixed(1)} req/s`, failures.size ? `non-200: ${JSON.stringify(Object.fromEntries(failures))}` : ''].join(' '),
  );
};

const adminToken = await signIn('admin@inventiveweb.test', 'Admin-Pass-1234!');
const chat = (body) => post(`${W}/s/chat/api`, body, { Authorization: `Bearer ${adminToken}` });
const boot = (await chat({ action: 'bootstrap' })).payload;
const general = boot?.channels?.find((channel) => channel.name === 'general')?.id;
const opened = general ? (await chat({ action: 'messages', channelId: general })).payload : null;
const newest = opened?.messages?.at(-1)?.createdAt;
const month = new Date().toISOString().slice(0, 7);

console.log(`${count} requests per route against ${W}; times in ms`);
await measure('graphql: one person (API key)', () => post(`${SERVER_URL}/graphql`, { query: '{ people(first: 1) { edges { node { id } } } }' }, { Authorization: `Bearer ${apiKey}` }));
await measure('booking: page', () => post(`${W}/s/booking/api`, { action: 'page', slug: state.types.aliceIntro }, forwardedFor()));
await measure('booking: slots for a month', () => post(`${W}/s/booking/api`, { action: 'slots', slug: state.types.aliceIntro, from: `${month}-01T00:00:00.000Z` }, forwardedFor()));
await measure('booking: slots, team round robin', () => post(`${W}/s/booking/api`, { action: 'slots', slug: state.types.roundRobin, from: `${month}-01T00:00:00.000Z` }, forwardedFor()));
if (general) {
  await measure('chat: idle poll of #general', () => chat({ action: 'messages', channelId: general, ...(newest ? { after: new Date(Date.parse(newest) - 5000).toISOString() } : {}), changesSince: new Date(Date.now() - 14_000).toISOString() }));
  await measure('chat: unread counts', () => chat({ action: 'channels' }));
}
await measure('booking: page', () => post(`${W}/s/booking/api`, { action: 'page', slug: state.types.aliceIntro }, forwardedFor()), 10);
if (general) await measure('chat: idle poll of #general', () => chat({ action: 'messages', channelId: general, changesSince: new Date(Date.now() - 14_000).toISOString() }), 10);
