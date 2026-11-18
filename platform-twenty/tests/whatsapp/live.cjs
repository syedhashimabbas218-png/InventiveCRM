// The WhatsApp inbox in a real browser: a customer writes in through the InventiveChat double and the message must
// appear in the open inbox by itself; a reply appears at once and then shows as sent. Saves screenshots.
// Needs the app connected to the double (run e2e.mjs first with the double left running) and the app's
// REALTIME_INTERNAL_URL pointing at the realtime service.
// Usage: SERVER_URL=http://localhost:3001 NODE_PATH=/opt/pw/node_modules node live.cjs <screenshot dir>
const { mkdirSync } = require('node:fs');
const { chromium } = require('playwright');

const SERVER_URL = require('../guard.cjs').testServerUrl();
const W = SERVER_URL.replace('//localhost', '//acme.localhost');
const MOCK = process.env.INVENTIVECHAT_MOCK_URL || 'http://127.0.0.1:8098';
const shots = process.argv[2] ?? 'shots';
mkdirSync(shots, { recursive: true });
let failures = 0;
const assert = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
};
const mock = async (path, body) => (await fetch(`${MOCK}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const run = Date.now().toString(36);
const phone = `+44770${String(Date.now()).slice(-6)}`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const appRequests = [];
  page.on('request', (request) => {
    if (/\/graphql|\/s\/whatsapp/.test(request.url())) appRequests.push(Date.now());
  });
  await page.goto(`${W}/`, { waitUntil: 'networkidle' });
  await page.getByText('Continue with Email').click({ timeout: 15000 }).catch(() => {});
  await page.getByPlaceholder(/email/i).fill('admin@inventiveweb.test');
  await page.keyboard.press('Enter');
  await page.getByPlaceholder(/password/i).fill('Admin-Pass-1234!');
  await page.keyboard.press('Enter');
  const folder = page.getByText('WhatsApp', { exact: true }).first();
  await folder.waitFor({ timeout: 60000 });
  const inbox = page.getByText('Inbox', { exact: true }).first();
  if (!(await inbox.isVisible())) await folder.click();
  await inbox.click({ timeout: 15000 });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${shots}/1-inbox.png` });

  const quietSince = Date.now();
  await page.waitForTimeout(10_000);
  const requestsWhileQuiet = appRequests.filter((at) => at >= quietSince).length;
  assert('an idle inbox does not ask for news', requestsWhileQuiet === 0, `${requestsWhileQuiet} requests in 10 s`);

  const text = `Hi, is my order ready? (${run})`;
  const sentAt = Date.now();
  await mock('/admin/inbound', { phone, profileName: `Grace Live${run}`, text });
  const shownAfter = await page.getByText(text).first().waitFor({ timeout: 15000 }).then(() => Date.now() - sentAt).catch(() => null);
  assert('a message from a customer appears in the open inbox by itself', shownAfter !== null, shownAfter === null ? 'not shown within 15 s' : `${shownAfter} ms after InventiveChat sent the webhook`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${shots}/2-new-message.png` });

  await page.getByText(text).first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${shots}/3-conversation.png` });
  const reply = `Yes, it is ready to collect (${run})`;
  const composer = page.getByRole('textbox', { name: /^Message / });
  await composer.click();
  await page.keyboard.type(reply, { delay: 5 });
  const typedAt = Date.now();
  await page.keyboard.press('Enter');
  const replyShown = await page.getByText(reply).first().waitFor({ timeout: 5000 }).then(() => Date.now() - typedAt).catch(() => null);
  assert('a reply shows in the thread straight away', replyShown !== null && replyShown < 1000, replyShown === null ? 'not shown' : `${replyShown} ms`);
  await page.waitForTimeout(2000);
  const left = await page.getByRole('textbox', { name: /^Message / }).inputValue();
  const focused = await page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA');
  assert('after Enter the box is empty and still has the cursor', left === '' && focused, JSON.stringify({ left, focused }));
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${shots}/4-replied.png` });

  // The same conversation on the contact's own page.
  await page.getByText(/^Grace Live/).last().click();
  await page.waitForTimeout(4000);
  // The record page's tab bar is the only place near the top that says just "WhatsApp".
  const labels = page.getByText('WhatsApp', { exact: true });
  for (let index = 0; index < (await labels.count()); index += 1) {
    const box = await labels.nth(index).boundingBox();
    if (box && box.y < 160 && box.x > 400 && (await labels.nth(index).isVisible())) {
      await labels.nth(index).click();
      break;
    }
  }
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${shots}/5-contact-page.png` });
  await browser.close();
  console.log(`SUMMARY ${failures === 0 ? 'all passed' : `${failures} failed`}`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
