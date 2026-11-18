// Live updates in a real browser: the admin has #general open, Bob posts through the API, and the message must appear
// on the admin's screen without a reload. Needs the realtime service running and the app's REALTIME_* variables set.
// Usage: SERVER_URL=http://localhost:3001 NODE_PATH=/opt/pw/node_modules node live.cjs <keys dir>
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');

const SERVER_URL = require('../guard.cjs').testServerUrl();
const state = JSON.parse(readFileSync(join(process.argv[2], 'state.json'), 'utf8'));
const W = state.workspaceUrl;
const origin = new URL(W).origin;
let failures = 0;
const assert = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
};

const metadata = async (query, variables) => {
  const response = await fetch(`${W}/metadata`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ query, variables }) });
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors[0].message);
  return payload.data;
};

const signIn = async (email, password) => {
  const { getLoginTokenFromCredentials } = await metadata(`mutation($email: String!, $password: String!, $origin: String!) { getLoginTokenFromCredentials(email: $email, password: $password, origin: $origin) { loginToken { token } } }`, { email, password, origin });
  const { getAuthTokensFromLoginToken } = await metadata(`mutation($loginToken: String!, $origin: String!) { getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) { tokens { accessOrWorkspaceAgnosticToken { token } } } }`, { loginToken: getLoginTokenFromCredentials.loginToken.token, origin });
  return getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken.token;
};

const chat = async (token, body) => (await fetch(`${W}/s/chat/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })).json();

(async () => {
  const bob = await signIn('bob@inventiveweb.test', 'Bob-Pass-1234!');
  const general = (await chat(bob, { action: 'bootstrap' })).channels.find((channel) => channel.name === 'general');
  assert('Bob is in #general', Boolean(general));
  const pass = await chat(bob, { action: 'livePass' });
  assert('the app hands out live update passes', typeof pass.live?.token === 'string' && pass.live.url.endsWith('/v1/stream'), JSON.stringify(pass).slice(0, 120));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const chatRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/s/chat/api')) chatRequests.push({ at: Date.now(), body: request.postData() ?? '' });
  });
  await page.goto(`${W}/`, { waitUntil: 'networkidle' });
  await page.getByText('Continue with Email').click({ timeout: 15000 }).catch(() => {});
  await page.getByPlaceholder(/email/i).fill('admin@inventiveweb.test');
  await page.keyboard.press('Enter');
  await page.getByPlaceholder(/password/i).fill('Admin-Pass-1234!');
  await page.keyboard.press('Enter');
  await page.getByText('Team chat', { exact: true }).first().click({ timeout: 60000 });
  await page.getByPlaceholder(/Message #general/).waitFor({ timeout: 60000 });
  // Give the screen time to fetch its pass and open the stream.
  await page.waitForTimeout(4000);
  assert('no "live updates are not set up" warning', (await page.getByText(/Live updates are not set up/).count()) === 0);

  const text = `Live check ${Date.now()}`;
  const quietSince = Date.now();
  await page.waitForTimeout(10_000);
  const pollsWhileQuiet = chatRequests.filter((request) => request.at >= quietSince && /"action":"messages"/.test(request.body)).length;
  assert('an idle screen does not ask for news', pollsWhileQuiet === 0, `${pollsWhileQuiet} message requests in 10 s`);

  const sentAt = Date.now();
  await chat(bob, { action: 'post', channelId: general.id, text, mentions: [], links: [] });
  const shownAfter = await page.getByText(text).waitFor({ timeout: 15000 }).then(() => Date.now() - sentAt).catch(() => null);
  assert('a message Bob posts appears on the admin screen by itself', shownAfter !== null, shownAfter === null ? 'not shown within 15 s' : `${shownAfter} ms after the post call started`);
  await browser.close();
  console.log(`SUMMARY ${failures === 0 ? 'all passed' : `${failures} failed`}`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
