// Pay-now links with the client's own Stripe or Revolut key, against mock-payments.mjs on the throwaway test server.
// Needs inv1 first (inv-state.json), the app variables STRIPE_API_URL and REVOLUT_API_URL pointing at the double,
// and Mailpit. Usage: SERVER_URL=http://localhost:3001 node inv6-payments.mjs <key file> <workspace url>
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { assert, client, pounds, summary, waitFor } from './inv-lib.mjs';

const SERVER_URL = process.env.SERVER_URL;
const MOCK = process.env.PAYMENTS_MOCK_URL || 'http://127.0.0.1:8096';
const MAILPIT = process.env.MAILPIT_URL || 'http://127.0.0.1:8025';
const [keyFile, W] = process.argv.slice(2);
const { gql } = client(keyFile);
const state = JSON.parse(readFileSync('inv-state.json', 'utf8'));
const run = Date.now().toString(36);
const startedAt = Date.now();
const origin = new URL(W).origin;

const call = async (url, token, query, variables = {}) => {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) });
  const payload = await response.json();
  if (payload.errors) throw new Error(JSON.stringify(payload.errors.map((error) => error.message)));
  return payload.data;
};
const loginToken = (await call(`${W}/metadata`, null, `mutation($email: String!, $password: String!, $origin: String!) { getLoginTokenFromCredentials(email: $email, password: $password, origin: $origin) { loginToken { token } } }`, { email: 'admin@inventiveweb.test', password: 'Admin-Pass-1234!', origin })).getLoginTokenFromCredentials.loginToken.token;
const userToken = (await call(`${W}/metadata`, null, `mutation($loginToken: String!, $origin: String!) { getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) { tokens { accessOrWorkspaceAgnosticToken { token } } } }`, { loginToken, origin })).getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken.token;
const applicationId = (await call(`${W}/metadata`, userToken, `{ findManyApplications { id universalIdentifier } }`)).findManyApplications.find((app) => app.universalIdentifier === '93ae1d55-5c54-4fac-922b-fd9fa4a69ab5').id;
const mock = async (path, body) => (await fetch(`${MOCK}${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})).json();
const route = async (path, body) => {
  const response = await fetch(`${W}/s${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
};

// The same steps as the Connect button: Twenty's authorize endpoint, our page, then the form post to Twenty's callback.
const connect = async (providerName, secretKey) => {
  const { generateTransientToken } = await call(`${W}/metadata`, userToken, `mutation { generateTransientToken { transientToken { token } } }`);
  const authorize = await fetch(`${SERVER_URL}/auth/apps/authorize?${new URLSearchParams({ applicationId, providerName, transientToken: generateTransientToken.transientToken.token })}`, { redirect: 'manual' });
  const pageUrl = authorize.headers.get('location');
  const page = await fetch(pageUrl);
  const html = await page.text();
  const action = /<form[^>]* action="([^"]+)"/.exec(html)?.[1]?.replace(/&#38;/g, '&');
  const callback = await fetch(action, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ secretKey }), redirect: 'manual' });
  const status = await (await fetch(`${W}/s/payments/connect-status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: providerName === 'stripe-payments' ? 'STRIPE' : 'REVOLUT', fingerprint: createHash('sha256').update(secretKey).digest('hex').slice(0, 16) }) })).json();
  return { authorizeStatus: authorize.status, pageStatus: page.status, pageUrl, action, callbackStatus: callback.status, connected: status.connected, html };
};

const getInvoice = async (id) => (await gql(`query($id: UUID!) { invoices(filter: { id: { eq: $id } }) { edges { node { id invoiceNumber status total { amountMicros } amountPaid { amountMicros } paymentLinkStatus paymentLinkUrl paymentReference paymentProvider paymentLinkAmountPence } } } }`, { id })).invoices.edges[0].node;
const money = (pence) => ({ amountMicros: pence * 10_000, currencyCode: 'GBP' });
const newIssuedInvoice = async (pence) => {
  const { createInvoice } = await gql(`mutation($data: InvoiceCreateInput!) { createInvoice(data: $data) { id } }`, { data: { name: `Payments ${run}`, companyId: state.companyId, personId: state.personId, template: 'UK_VAT_INVOICE' } });
  await gql(`mutation($data: [InvoiceLineCreateInput!]!) { createInvoiceLines(data: $data) { id } }`, { data: [{ invoiceId: createInvoice.id, lineOrder: 0, description: 'Boiler repair', quantity: 1, unitPrice: money(pence), vatRate: 'STANDARD_20' }] });
  await waitFor('totals', async () => Number((await getInvoice(createInvoice.id)).total?.amountMicros) > 0, 60000);
  await gql(`mutation($id: UUID!) { updateInvoice(id: $id, data: { status: ISSUED }) { id } }`, { id: createInvoice.id });
  return waitFor('issued with a link', async () => { const invoice = await getInvoice(createInvoice.id); return invoice.status === 'ISSUED' && invoice.paymentLinkStatus !== 'NONE' ? invoice : null; }, 90000);
};
const profileId = (await gql(`{ businessProfiles(first: 1) { edges { node { id } } } }`)).businessProfiles.edges[0].node.id;
const setProvider = (provider) => gql(`mutation($id: UUID!, $data: BusinessProfileUpdateInput!) { updateBusinessProfile(id: $id, data: $data) { id } }`, { id: profileId, data: { onlinePayments: provider, sendOnIssue: true, emailSendingMethod: 'OUR_SERVER' } });
const personEmail = (await gql(`query($id: UUID!) { people(filter: { id: { eq: $id } }) { edges { node { emails { primaryEmail } } } } }`, { id: state.personId })).people.edges[0].node.emails.primaryEmail;
const mailsTo = async (address) => ((await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`)).json()).messages ?? []).filter((message) => Date.parse(message.Created) >= startedAt);

// Connecting: a wrong key connects nothing; the page refuses foreign callbacks; a valid key connects.
const foreign = await fetch(`${W}/s/payments/connect?provider=STRIPE&callback=${encodeURIComponent('https://evil.example/auth/apps/custom/callback?state=x')}`);
assert('the connect page refuses a callback that is not Twenty’s own', foreign.status === 400, String(foreign.status));
await setProvider('STRIPE');
const stripeConnections = async () => (await call(`${W}/metadata`, userToken, `{ myConnectedAccounts { handle } }`)).myConnectedAccounts.filter((account) => account.handle.startsWith('Stripe')).length;
const before = await stripeConnections();
const bad = await connect('stripe-payments', 'rk_test_wrongkey1234567890');
const after = await stripeConnections();
assert('a key Stripe refuses is not stored, and the page is told so', bad.pageStatus === 200 && after === before && bad.connected === false, `${before} -> ${after} Stripe connections, connected=${bad.connected}`);
const good = await connect('stripe-payments', `rk_test_valid${run}abcdefghij`);
assert('a valid Stripe key connects through Twenty’s custom connection flow', good.authorizeStatus === 302 && good.pageStatus === 200 && /type="password"/.test(good.html) && good.connected === true, `${good.authorizeStatus}/${good.pageStatus}/${good.callbackStatus} connected=${good.connected}`);

// Issuing creates the link for the full amount and the first email carries it.
const stripeInvoice = await newIssuedInvoice(10_000);
const createdLink = (await mock('/admin/log')).filter((entry) => entry.provider === 'stripe' && entry.method === 'POST' && entry.path === '/v1/payment_links').pop();
assert('issuing creates a single-use Stripe link for what is owed', stripeInvoice.paymentLinkStatus === 'OPEN' && /^https:\/\/buy\.stripe\.test\//.test(stripeInvoice.paymentLinkUrl) && createdLink?.form['line_items[0][price_data][unit_amount]'] === '12000' && createdLink.form['restrictions[completed_sessions][limit]'] === '1' && Boolean(createdLink.idempotencyKey), `${stripeInvoice.paymentLinkStatus} ${createdLink?.form['line_items[0][price_data][unit_amount]']}`);
const invoiceMail = await waitFor('invoice email', async () => (await mailsTo(personEmail)).find((message) => message.Subject.includes(stripeInvoice.invoiceNumber)), 60000).catch(() => null);
const invoiceHtml = invoiceMail ? (await (await fetch(`${MAILPIT}/api/v1/message/${invoiceMail.ID}`)).json()).HTML : '';
assert('the invoice email has a Pay now button with the link', invoiceHtml.includes(stripeInvoice.paymentLinkUrl) && /Pay £120\.00 now/.test(invoiceHtml), invoiceMail?.Subject);

const again = await route('/payments/link', { invoiceId: stripeInvoice.id });
assert('asking again reuses the open link', again.body?.url === stripeInvoice.paymentLinkUrl, again.body?.url);
await gql(`mutation($id: UUID!) { updateInvoice(id: $id, data: { amountPaid: { amountMicros: 20000000, currencyCode: "GBP" }, status: PART_PAID }) { id } }`, { id: stripeInvoice.id });
const smaller = await route('/payments/link', { invoiceId: stripeInvoice.id, send: true, channels: ['EMAIL'] });
const partInvoice = await getInvoice(stripeInvoice.id);
const deactivated = (await mock('/admin/log')).some((entry) => entry.path === `/v1/payment_links/${stripeInvoice.paymentReference}` && entry.form.active === 'false');
assert('after a part payment the link is replaced by one for the rest, and the old one is closed', partInvoice.paymentLinkAmountPence === 10_000 && partInvoice.paymentLinkUrl !== stripeInvoice.paymentLinkUrl && deactivated, `${partInvoice.paymentLinkAmountPence} closed ${deactivated}`);
const linkMail = await waitFor('payment link email', async () => (await mailsTo(personEmail)).find((message) => /^Pay invoice/.test(message.Subject)), 60000).catch(() => null);
assert('the pay-now link can be sent on its own', smaller.body?.success === true && /online/.test(linkMail?.Subject ?? ''), `${JSON.stringify(smaller.body?.deliveries)} ${linkMail?.Subject}`);

await mock('/admin/pay', { reference: partInvoice.paymentReference });
const reconcile = await route('/payments/reconcile', {});
const paid = await getInvoice(stripeInvoice.id);
const closedAfterPay = (await mock('/admin/log')).some((entry) => entry.path === `/v1/payment_links/${partInvoice.paymentReference}` && entry.form.active === 'false');
assert('a completed Stripe payment marks the invoice paid and closes the link', paid.status === 'PAID' && pounds(paid.amountPaid) === '120.00' && paid.paymentLinkStatus === 'PAID' && closedAfterPay, `${JSON.stringify(reconcile.body)} ${paid.status} £${pounds(paid.amountPaid)} ${paid.paymentLinkStatus}`);

// Revolut: the same through a Merchant API order.
await setProvider('REVOLUT');
const revolutConnect = await connect('revolut-payments', `sk_sandbox_valid${run}abcdefghij`);
const revolutInvoice = await newIssuedInvoice(5_000);
const order = (await mock('/admin/log')).filter((entry) => entry.provider === 'revolut' && entry.method === 'POST' && entry.path === '/api/orders').pop();
assert('with Revolut, issuing creates a Merchant API order for what is owed', revolutConnect.connected === true && revolutInvoice.paymentProvider === 'REVOLUT' && /^https:\/\/checkout\.revolut\.test\//.test(revolutInvoice.paymentLinkUrl) && order?.body.amount === 6000 && order.body.currency === 'GBP' && Boolean(order.version), `${revolutInvoice.paymentLinkStatus} ${order?.body.amount} ${order?.version}`);
await mock('/admin/pay', { reference: revolutInvoice.paymentReference });
await route('/payments/reconcile', {});
const revolutPaid = await getInvoice(revolutInvoice.id);
assert('a completed Revolut order marks the invoice paid', revolutPaid.status === 'PAID' && revolutPaid.paymentLinkStatus === 'PAID', `${revolutPaid.status} ${revolutPaid.paymentLinkStatus}`);

await setProvider('NONE');
summary();
