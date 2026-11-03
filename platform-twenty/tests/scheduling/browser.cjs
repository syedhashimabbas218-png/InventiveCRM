// Browser checks: booking page (desktop and phone), map selector, embed on another website, domain allowlist, and the
// Scheduling pages inside Twenty. Screenshots go to the output directory.
// Usage: node browser.cjs <state file> <api key file> <output directory>
const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { mkdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const [stateFile, keyFile, out] = process.argv.slice(2);
const state = JSON.parse(readFileSync(stateFile, 'utf8'));
const key = readFileSync(keyFile, 'utf8').trim();
const W = state.workspaceUrl;
mkdirSync(out, { recursive: true });
const results = [];
const assert = (name, passed, detail = '') => {
  results.push(Boolean(passed));
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
};
const gql = async (query, variables = {}) => {
  const response = await fetch('http://localhost:3000/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ query, variables }) });
  return (await response.json()).data;
};
const shot = (page, name) => page.screenshot({ path: join(out, `${name}.png`), fullPage: true });

// A different-origin "customer website" that embeds the booking widget three ways.
const site = createServer((request, response) => {
  const slug = new URL(request.url, 'http://x').searchParams.get('slug');
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(`<!doctype html><html><head><meta charset="utf-8"><title>Acme Plumbing</title><style>body{font-family:sans-serif;margin:0;padding:24px;background:#f4f1ea}</style></head>
<body><h1>Acme Plumbing &amp; Heating</h1><p>Book a visit below, or <a href="#" data-twenty-booking-popup="${slug}" id="popup">open the booking window</a>.</p>
<div data-twenty-booking="${slug}" id="inline" style="background:#fff;border-radius:12px"></div>
<script src="${W}/s/booking/embed.js" data-floating="${slug}" data-label="Book a call" async></script></body></html>`);
});

(async () => {
  await new Promise((resolve) => site.listen(8099, '127.0.0.1', resolve));
  // Reruns from one machine would otherwise hit the per-visitor booking limit.
  await gql(`mutation { destroyPublicRequestCounters(filter: { key: { like: "book|%" } }) { id } }`);
  const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,*.localhost,127.0.0.1' } });

  // Booking page, desktop: pick a day, a time, fill in, book.
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, timezoneId: 'Europe/London' });
  await page.goto(`${W}/s/book/${state.types.aliceIntro}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.cal button.on', { timeout: 30000 });
  await shot(page, '01-booking-calendar');
  const nextMonth = page.locator('#next');
  await page.locator('.cal button.on').nth(3).click();
  await page.waitForSelector('.times button');
  await shot(page, '02-booking-times');
  await page.locator('.times button').first().click();
  await page.fill('#n', 'Browser Customer');
  await page.fill('#e', `browser.${state.run}@customers.test`);
  await page.fill('#q_topic', 'Booked from a real browser');
  await shot(page, '03-booking-details');
  await page.waitForTimeout(3200);
  await page.click('#sub');
  await page.waitForSelector('h2.ok', { timeout: 60000 });
  await shot(page, '04-booking-confirmed');
  const manageHref = await page.locator('a.btn').getAttribute('href');
  assert('a customer books through the page in a browser and is given a manage link', /\/booking\/manage\//.test(manageHref ?? ''), await page.locator('h2.ok').innerText());
  void nextMonth;

  // Manage page from the confirmation.
  await page.goto(manageHref, { waitUntil: 'networkidle' });
  await page.waitForSelector('#rs', { timeout: 30000 });
  await shot(page, '05-manage');
  assert('the manage page offers reschedule and cancel', (await page.locator('#rs').count()) === 1 && (await page.locator('#cx').count()) === 1);

  // Phone layout.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await phone.goto(`${W}/s/book/${state.types.roundRobin}`, { waitUntil: 'networkidle' });
  await phone.waitForSelector('.cal button.on', { timeout: 30000 });
  const width = await phone.evaluate(() => document.documentElement.scrollWidth);
  await shot(phone, '06-booking-phone');
  assert('the booking page fits a phone screen without sideways scrolling', width <= 390, `scrollWidth ${width}`);

  // Map selector with address search, road routing and advisor list.
  const map = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await map.goto(`${W}/s/book/${state.types.choose}`, { waitUntil: 'networkidle' });
  await map.waitForSelector('#q');
  await map.fill('#q', 'Headingley Lane Leeds');
  await map.waitForSelector('#sug button', { timeout: 30000 });
  await map.locator('#sug button').first().click();
  await map.waitForSelector('.adv', { timeout: 60000 });
  await map.waitForTimeout(2500);
  await shot(map, '07-map-selector');
  const listed = await map.locator('.adv strong').allInnerTexts();
  const tiles = await map.locator('.leaflet-tile-loaded').count();
  assert('the map selector geocodes the address, draws the map and lists nearby advisors', listed[0] === 'Carol Headingley' && tiles > 0, `${listed.join(', ')}; ${tiles} tiles`);
  await map.locator('.adv').first().click();
  await map.waitForSelector('.cal button.on', { timeout: 60000 });
  await shot(map, '08-map-advisor-times');
  assert('choosing an advisor on the map shows their bookable times', (await map.locator('.cal button.on').count()) > 0);

  // Embed on another website: inline, popup and floating button; booking inside the frame.
  const host = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await host.goto(`http://127.0.0.1:8099/?slug=${state.types.bobConsult}`, { waitUntil: 'networkidle' });
  const inline = host.frameLocator('#inline iframe');
  await inline.locator('.cal button.on').first().waitFor({ timeout: 30000 });
  await host.waitForTimeout(1500);
  const frameHeight = await host.locator('#inline iframe').evaluate((frame) => frame.getBoundingClientRect().height);
  await shot(host, '09-embed-inline');
  assert('the inline widget loads on another website and sizes itself to its content', frameHeight > 400, `${Math.round(frameHeight)}px`);
  await inline.locator('.cal button.on').nth(2).click();
  await inline.locator('.times button').first().click();
  await inline.locator('#n').fill('Embed Customer');
  await inline.locator('#e').fill(`embed.${state.run}@customers.test`);
  await host.waitForTimeout(3200);
  await inline.locator('#sub').click();
  await inline.locator('h2.ok').waitFor({ timeout: 60000 });
  const embedded = (await gql(`query($email: String!) { appointments(filter: { customerEmail: { eq: $email } }) { edges { node { source } } } }`, { email: `embed.${state.run}@customers.test` })).appointments.edges[0]?.node;
  assert('a booking made inside the widget is recorded as coming from the website embed', embedded?.source === 'EMBED', embedded?.source);
  await host.click('#twenty-booking-float');
  await host.frameLocator('iframe >> nth=1').locator('.cal').waitFor({ timeout: 30000 });
  await shot(host, '10-embed-popup');
  assert('the floating button opens the booking popup', true);
  await host.keyboard.press('Escape');

  // Domain allowlist: the same widget on a site that is not allowed.
  await gql(`mutation($slug: String!) { updateAppointmentTypes(filter: { slug: { eq: $slug } }, data: { allowedEmbedDomains: "acmeplumbing.co.uk" }) { id } }`, { slug: state.types.bobConsult });
  await host.reload({ waitUntil: 'networkidle' });
  await host.frameLocator('#inline iframe').locator('.error').waitFor({ timeout: 30000 });
  const blocked = await host.frameLocator('#inline iframe').locator('.error').innerText();
  await gql(`mutation($slug: String!) { updateAppointmentTypes(filter: { slug: { eq: $slug } }, data: { allowedEmbedDomains: "" }) { id } }`, { slug: state.types.bobConsult });
  assert('the widget refuses to work on a website outside the allowlist', /not available on this website/.test(blocked), blocked);

  // Inside Twenty: sign in and open the Scheduling pages.
  const app = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await app.goto(`${W}/`, { waitUntil: 'networkidle' });
  await app.getByText('Continue with Email').click({ timeout: 15000 }).catch(() => {});
  await app.getByPlaceholder(/email/i).fill('admin@inventiveweb.test');
  await app.keyboard.press('Enter');
  await app.getByPlaceholder(/password/i).fill('Admin-Pass-1234!');
  await app.keyboard.press('Enter');
  await app.waitForTimeout(7000);
  await app.getByText('Scheduling', { exact: true }).first().click({ timeout: 15000 }).catch(() => {});
  await app.waitForTimeout(1500);
  await app.getByText('Overview', { exact: true }).first().click({ timeout: 15000 });
  await app.waitForTimeout(9000);
  await shot(app, '11-twenty-scheduling-overview');
  const overview = await app.locator('body').innerText();
  assert('the Scheduling overview renders inside Twenty with live data', /Booking pages/.test(overview) && /Upcoming/.test(overview), overview.slice(0, 120).replace(/\n/g, ' '));
  await app.getByText('Calendar connections', { exact: true }).first().click({ timeout: 15000 });
  await app.waitForTimeout(8000);
  await shot(app, '12-twenty-calendar-connections');
  const connectionsText = await app.locator('body').innerText();
  assert('the Calendar connections page lists the Google account and its calendars', /alice@googlemail.test/.test(connectionsText) && /Calendars that block my availability/.test(connectionsText));
  await app.getByText(/^Appointment calendar/).first().click({ timeout: 15000 });
  await app.waitForTimeout(6000);
  await shot(app, '13-twenty-appointment-calendar');
  assert('the appointment calendar view opens from the Scheduling menu', /calendar|Mon|Tue/i.test(await app.locator('body').innerText()));

  // Availability editor: time off, then extra weekly hours, both undone afterwards.
  const weeklyHours = async () => (await gql(`{ advisors(filter: { email: { eq: "alice@inventiveweb.test" } }) { edges { node { schedule { weeklyHours } } } } }`)).advisors.edges[0]?.node.schedule?.weeklyHours ?? {};
  const timeOffCount = async (name) => (await gql(`query($name: String!) { availabilityOverrides(filter: { name: { eq: $name } }) { totalCount } }`, { name })).availabilityOverrides.totalCount;
  await app.getByText('Availability', { exact: true }).first().click({ timeout: 15000 });
  await app.getByText('Weekly hours', { exact: true }).waitFor({ timeout: 30000 });
  await app.waitForTimeout(1500);
  await shot(app, '14-twenty-availability');
  const reason = `Browser day off ${state.run}`;
  await app.getByPlaceholder('Reason (optional)').fill(reason);
  await app.getByLabel('First day').fill('2027-03-01');
  await app.getByLabel('Last day').fill('2027-03-02');
  await app.getByRole('button', { name: 'Add', exact: true }).click();
  await app.getByText(reason).waitFor({ timeout: 20000 });
  assert('time off added on the availability page is saved to the schedule', (await timeOffCount(reason)) === 1);
  await app.locator('div').filter({ has: app.getByText(reason, { exact: true }) }).filter({ has: app.getByRole('button', { name: 'Remove' }) }).last().getByRole('button', { name: 'Remove' }).click();
  await app.getByText(reason, { exact: true }).waitFor({ state: 'detached', timeout: 20000 });
  assert('time off can be removed again', (await timeOffCount(reason)) === 0);
  const before = await weeklyHours();
  const sunday = app.locator('div').filter({ has: app.getByText('Sunday', { exact: true }) }).last();
  await sunday.getByRole('button', { name: 'Remove' }).click();
  await app.getByRole('button', { name: 'Save', exact: true }).click();
  await app.getByText('Availability saved').waitFor({ timeout: 20000 });
  const withoutSunday = await weeklyHours();
  await app.waitForTimeout(1500);
  await sunday.getByRole('button', { name: 'Set hours' }).click();
  await app.getByRole('button', { name: 'Save', exact: true }).click();
  await app.waitForTimeout(4000);
  const restored = await weeklyHours();
  assert('weekly hours edited on the page are saved, and can be put back', Boolean(before.sun) && !withoutSunday.sun && JSON.stringify(restored.sun) === JSON.stringify(before.sun), `${JSON.stringify(before.sun)} -> ${JSON.stringify(withoutSunday.sun ?? null)} -> ${JSON.stringify(restored.sun)}`);

  // Overview: advisor map, and quick creation of a draft appointment type.
  await app.getByText('Overview', { exact: true }).first().click({ timeout: 15000 });
  await app.getByRole('button', { name: 'Advisor map' }).click({ timeout: 30000 });
  const staffMap = app.frameLocator('iframe[src*="/scheduling/map"]');
  await staffMap.locator('.leaflet-tile-loaded').first().waitFor({ timeout: 30000 });
  await app.waitForTimeout(2000);
  await shot(app, '15-twenty-advisor-map');
  const legend = await staffMap.locator('#legend').innerText();
  const markers = await staffMap.locator('path.leaflet-interactive').count();
  assert('the advisor map shows advisors, offices and service areas inside Twenty', /\d+ advisors, \d+ offices/.test(legend) && markers >= 3, `${legend.split('\n')[0]}; ${markers} shapes`);
  await app.getByRole('button', { name: 'Hide advisor map' }).click();
  await app.getByRole('button', { name: 'New appointment type' }).click();
  const typeName = `Browser quick type ${state.run}`;
  await app.getByPlaceholder('Name, e.g. Free consultation').fill(typeName);
  await app.getByLabel('Where').selectOption('AT_CUSTOMER');
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByLabel('Advisor by location').selectOption('WITHIN_RADIUS');
  await app.getByRole('button', { name: 'Create draft' }).click();
  await app.waitForURL(/\/object\/appointmentType\//, { timeout: 30000 });
  await app.waitForTimeout(4000);
  await shot(app, '16-twenty-new-type-record');
  const created = (await gql(`query($name: String!) { appointmentTypes(filter: { name: { eq: $name } }) { edges { node { id status meetingFormat locationMode } } } }`, { name: typeName })).appointmentTypes.edges[0]?.node;
  assert('a new appointment type is created as a draft from the overview and opens on its record page', created?.status === 'DRAFT' && created.meetingFormat === 'AT_CUSTOMER' && created.locationMode === 'WITHIN_RADIUS', JSON.stringify(created));
  if (created) await gql(`mutation($id: UUID!) { destroyAppointmentType(id: $id) { id } }`, { id: created.id });

  await browser.close();
  site.close();
  console.log(`SUMMARY ${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((error) => {
  console.error('FAIL', error.message.split('\n').slice(0, 3).join(' '));
  site.close();
  process.exit(1);
});
