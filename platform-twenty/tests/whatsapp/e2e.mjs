// WhatsApp end to end on the throwaway test server, against mock-inventivechat.mjs (InventiveChat and the realtime hub).
// Needs the app installed in the acme workspace with the variables from whatsapp-test-vars.env, where
// INVENTIVECHAT_API_URL and REALTIME_INTERNAL_URL point at the double (http://127.0.0.1:8098).
// Usage: SERVER_URL=http://localhost:3001 node e2e.mjs <api key file> <variables env file>
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { testServerUrl } from '../guard.cjs';

const SERVER_URL = testServerUrl();
const MOCK = process.env.INVENTIVECHAT_MOCK_URL || 'http://127.0.0.1:8098';
const APP_ID = '23e5cd3d-e631-461b-9e06-849c0a577688';
const [keyFile, varsFile] = process.argv.slice(2);
const apiKey = readFileSync(keyFile, 'utf8').trim();
const vars = Object.fromEntries(readFileSync(varsFile, 'utf8').split('\n').filter((line) => line.includes('=')).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const W = SERVER_URL.replace('//localhost', '//acme.localhost');
const origin = new URL(W).origin;
const run = Date.now().toString(36);
// Numbers unique to this run, so repeated runs never match each other's contacts.
const digits = String(Date.now()).slice(-6);
const phoneOf = (prefix) => `+4477${prefix}${digits}`;

let failures = 0;
let passes = 0;
const assert = (label, condition, detail = '') => {
  if (condition) passes += 1;
  else failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'} ${label}${condition ? '' : `  (${detail})`}`);
};
const skip = (label, reason) => console.log(`SKIP ${label} (${reason})`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (label, check, timeout = 30_000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await check().catch(() => null);
    if (value) return value;
    await sleep(1000);
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
const first = (connection) => connection?.edges?.[0]?.node ?? null;
const loginToken = (await call(`${W}/metadata`, null, `mutation($email: String!, $password: String!, $origin: String!) { getLoginTokenFromCredentials(email: $email, password: $password, origin: $origin) { loginToken { token } } }`, { email: 'admin@inventiveweb.test', password: 'Admin-Pass-1234!', origin })).getLoginTokenFromCredentials.loginToken.token;
const userToken = (await call(`${W}/metadata`, null, `mutation($loginToken: String!, $origin: String!) { getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) { tokens { accessOrWorkspaceAgnosticToken { token } } } }`, { loginToken, origin })).getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken.token;
const applicationId = (await call(`${W}/metadata`, userToken, `{ findManyApplications { id universalIdentifier } }`)).findManyApplications.find((app) => app.universalIdentifier === APP_ID)?.id;
if (!applicationId) throw new Error('The WhatsApp app is not installed in the acme workspace.');
const adminMemberId = (await call(`${W}/metadata`, userToken, `{ currentUser { workspaceMember { id } } }`)).currentUser.workspaceMember.id;

const mock = async (path, body) => (await fetch(`${MOCK}${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})).json();
const mockLog = async (path) => (await mock('/admin/log')).filter((entry) => entry.path === path);
const route = async (path, body, token = userToken) => {
  const response = await fetch(`${W}/s${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
};
const api = (body, token) => route('/whatsapp/api', body, token);
const gateway = async (payload, { secret = vars.WHATSAPP_GATEWAY_SECRET, timestamp = Math.floor(Date.now() / 1000) } = {}) => {
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
  const response = await fetch(`${W}/s/whatsapp/gateway`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-InventiveCRM-Timestamp': String(timestamp), 'X-InventiveCRM-Signature': signature }, body });
  return { status: response.status, body: await response.json().catch(() => null) };
};

const CONVERSATION = 'id name customerPhone personId companyId assigneeId status handling unreadCount windowExpiresAt optedOut customerWaiting inventiveChatConversationId';
const MESSAGE = 'id conversationId personId direction messageType text templateName status error sentById sentByName inventiveChatMessageId idempotencyKey deliveryId retryAt waitingFor recipientPhone';
const conversationByIcId = async (id) => first((await gql(`query($id: String) { whatsappConversations(filter: { inventiveChatConversationId: { eq: $id } }) { edges { node { ${CONVERSATION} } } } }`, { id })).whatsappConversations);
const messagesIn = async (conversationId) => (await gql(`query($id: UUID) { whatsappMessages(filter: { conversationId: { eq: $id } }, orderBy: [{ occurredAt: AscNullsLast }]) { edges { node { ${MESSAGE} } } } }`, { id: conversationId })).whatsappMessages.edges.map((edge) => edge.node);
const messageBy = async (filter, variables) => first((await gql(`query($value: String) { whatsappMessages(filter: ${filter}) { edges { node { ${MESSAGE} } } } }`, variables)).whatsappMessages);

await mock('/admin/reset', {});

// 1. Connecting InventiveChat: only Twenty's own callback, only a valid key, and our old webhook replaced.
const connect = async (secretKey) => {
  const { generateTransientToken } = await call(`${W}/metadata`, userToken, `mutation { generateTransientToken { transientToken { token } } }`);
  const authorize = await fetch(`${SERVER_URL}/auth/apps/authorize?${new URLSearchParams({ applicationId, providerName: 'inventivechat', transientToken: generateTransientToken.transientToken.token })}`, { redirect: 'manual' });
  const page = await fetch(authorize.headers.get('location'));
  const html = await page.text();
  const action = /<form[^>]* action="([^"]+)"/.exec(html)?.[1]?.replace(/&#38;/g, '&');
  await fetch(action, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ secretKey }), redirect: 'manual' });
  const fingerprint = createHash('sha256').update(secretKey).digest('hex').slice(0, 16);
  const status = await (await fetch(`${W}/s/whatsapp/connect-status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fingerprint }) })).json();
  return { pageStatus: page.status, connected: status.connected };
};
const loadSettings = async () => first((await gql(`{ whatsappSettingsRecords(orderBy: [{ createdAt: AscNullsLast }], first: 1) { edges { node { id tenantId whatsappAccountId phoneNumber displayName subscriptionId webhookSecret webhookProblem } } } }`)).whatsappSettingsRecords);
const foreign = await fetch(`${W}/s/whatsapp/connect?callback=${encodeURIComponent('https://evil.example/auth/apps/custom/callback?state=x')}`);
assert('the connect page refuses a callback that is not Twenty’s own', foreign.status === 400, String(foreign.status));
const bad = await connect(`wa_bad_${run}abcdefghij`);
assert('a key InventiveChat refuses is not connected', bad.pageStatus === 200 && bad.connected === false, JSON.stringify(bad));
const good = await connect(`wa_test_${run}abcdefghij`);
assert('a valid InventiveChat key connects', good.connected === true, JSON.stringify(good));
const eventsUrl = `${W}/s/whatsapp/events`;
const firstSubscription = (await mock('/admin/subscriptions')).find((entry) => entry.url === eventsUrl && entry.status === 'active');
assert('the workspace webhook is registered for every event, conversation.updated and consent.updated included', firstSubscription && ['message.received', 'message.status_updated', 'customer.opted_out', 'conversation.updated', 'consent.updated'].every((type) => firstSubscription.event_types.includes(type)), JSON.stringify(firstSubscription));
const firstSettings = await loadSettings();
assert('the account and its only active number are saved, and the webhook secret only sealed', firstSettings?.tenantId === 'ten_acme' && firstSettings.whatsappAccountId === 'wac_1' && firstSettings.phoneNumber === '+44 7700 900000' && firstSettings.subscriptionId === firstSubscription?.id && firstSettings.webhookSecret?.startsWith('v1.') && !firstSettings.webhookSecret.includes('whsec_') && !firstSettings.webhookProblem, JSON.stringify(firstSettings));
await connect(`wa_test_${run}abcdefghij`);
const afterReconnect = (await mock('/admin/subscriptions')).filter((entry) => entry.url === eventsUrl);
const settings = await loadSettings();
assert('connecting again disables our old webhook and registers a new one', afterReconnect.find((entry) => entry.id === firstSubscription?.id)?.status === 'disabled' && afterReconnect.filter((entry) => entry.status === 'active').length === 1 && settings.subscriptionId !== firstSubscription?.id && afterReconnect.some((entry) => entry.id === settings.subscriptionId && entry.status === 'active'), JSON.stringify(afterReconnect));
await gql(`mutation($id: UUID!, $data: WhatsappSettingsUpdateInput!) { updateWhatsappSettings(id: $id, data: $data) { id } }`, { id: settings.id, data: { autoCreatePeople: true, defaultLanguageCode: 'en_GB', gatewayTemplates: null } });

// 2. A message from an unknown number: conversation, message and a new person.
const unknownPhone = phoneOf('01');
const unknown = await mock('/admin/inbound', { phone: unknownPhone, profileName: `Wendy Unknown${run}`, text: `Hello from a new customer ${run}` });
assert('the app accepts a signed webhook', unknown.results?.[0]?.status === 200, JSON.stringify(unknown.results?.[0]));
const unknownConversation = await conversationByIcId(unknown.conversationId);
const unknownMessages = unknownConversation ? await messagesIn(unknownConversation.id) : [];
assert('a conversation and an inbound message are recorded, unread and open for replies', unknownConversation?.customerPhone === unknownPhone && unknownConversation.unreadCount === 1 && Date.parse(unknownConversation.windowExpiresAt) > Date.now() && unknownMessages[0]?.direction === 'INBOUND' && unknownMessages[0].text.includes(run), JSON.stringify({ unknownConversation, unknownMessages }));
const createdPerson = unknownConversation?.personId ? first((await gql(`query($id: UUID) { people(filter: { id: { eq: $id } }) { edges { node { id name { firstName lastName } phones { primaryPhoneNumber primaryPhoneCallingCode } } } } }`, { id: unknownConversation.personId })).people) : null;
assert('an unknown number becomes a person named from the WhatsApp profile, with the number', createdPerson?.name.firstName === 'Wendy' && `${createdPerson.phones.primaryPhoneCallingCode}${createdPerson.phones.primaryPhoneNumber}` === unknownPhone && unknownMessages[0]?.personId === createdPerson.id, JSON.stringify(createdPerson));

// 3. A known number links to the saved person and their company.
const knownPhone = phoneOf('02');
const company = (await gql(`mutation($data: CompanyCreateInput!) { createCompany(data: $data) { id } }`, { data: { name: `Known Co ${run}` } })).createCompany;
const known = (await gql(`mutation($data: PersonCreateInput!) { createPerson(data: $data) { id } }`, { data: { name: { firstName: 'Kim', lastName: `Known${run}` }, companyId: company.id, phones: { primaryPhoneNumber: knownPhone.slice(3), primaryPhoneCallingCode: '+44', primaryPhoneCountryCode: 'GB' } } })).createPerson;
const knownInbound = await mock('/admin/inbound', { phone: knownPhone, profileName: 'Someone Else', text: `Is my order ready? ${run}` });
const knownConversation = await conversationByIcId(knownInbound.conversationId);
const sameName = await gql(`query($name: String) { people(filter: { name: { lastName: { eq: $name } } }) { totalCount } }`, { name: `Known${run}` });
assert('a known number is linked to the saved person and their company, without a new person', knownConversation?.personId === known.id && knownConversation.companyId === company.id && sameName.people.totalCount === 1, JSON.stringify(knownConversation));

// 4. Forged, stale, altered and replayed webhooks.
const fakeMessage = (id, text) => ({ message: { id, conversation_id: knownInbound.conversationId, whatsapp_account_id: 'wac_1', customer: knownPhone.slice(1), profile_name: null, direction: 'inbound', sender: { type: 'customer', id: knownPhone.slice(1), name: null }, type: 'text', text, template: null, attachment: null, status: 'delivered', ai_topic: null, imported_from_history: false, idempotency_key: null, sent_at: null, received_at: new Date().toISOString() } });
const forged = await mock('/admin/emit', { type: 'message.received', data: fakeMessage(`msg_forged_${run}`, 'forged'), sign: { secret: 'whsec_wrong' } });
const stale = await mock('/admin/emit', { type: 'message.received', data: fakeMessage(`msg_stale_${run}`, 'stale'), sign: { timestamp: Math.floor(Date.now() / 1000) - 600 } });
const altered = await mock('/admin/emit', { type: 'message.received', data: fakeMessage(`msg_altered_${run}`, 'altered'), sign: { tamper: true } });
const afterForgery = await messagesIn(knownConversation.id);
assert('forged, stale and altered webhooks are refused and write nothing', forged.results[0].status === 401 && stale.results[0].status === 401 && altered.results[0].status === 401 && afterForgery.length === 1, JSON.stringify([forged.results[0].status, stale.results[0].status, altered.results[0].status, afterForgery.length]));
const original = knownInbound.results[0].sent;
const replay = await fetch(eventsUrl, { method: 'POST', headers: original.headers, body: original.body });
const afterReplay = await conversationByIcId(knownInbound.conversationId);
assert('a replayed webhook changes nothing: no second message, unread unchanged', replay.status === 200 && (await messagesIn(knownConversation.id)).length === 1 && afterReplay.unreadCount === 1, `${replay.status} ${afterReplay.unreadCount}`);

// 5. A staff reply from the inbox route goes out on behalf of the signed-in person.
const clientMessageId = randomUUID();
const reply = await api({ action: 'send', conversationId: knownConversation.id, text: `On its way ${run}`, clientMessageId });
const sends = (await mockLog('/v1/messages/send')).filter((entry) => entry.body?.payload?.body === `On its way ${run}`);
assert('a staff reply is sent as text on behalf of that person, without a claim', reply.status === 200 && sends.length === 1 && sends[0].body.payload.type === 'text' && sends[0].body.payload.on_behalf_of?.crm_member_id === adminMemberId && !sends[0].body.payload.claim_id && (await mockLog(`/v1/conversations/${knownInbound.conversationId}/claim`)).length === 0, JSON.stringify({ reply, sends }));
const sentRecord = await messageBy('{ id: { eq: $value } }', { value: clientMessageId });
assert('the reply is recorded as sent by that person, under the id the screen chose', sentRecord?.status === 'SENT' && sentRecord.sentById === adminMemberId && sentRecord.inventiveChatMessageId && sentRecord.direction === 'OUTBOUND', JSON.stringify(sentRecord));
const again = await api({ action: 'send', conversationId: knownConversation.id, text: `On its way ${run}`, clientMessageId });
assert('sending the same message id again does not send twice', again.status === 200 && (await mockLog('/v1/messages/send')).filter((entry) => entry.body?.payload?.body === `On its way ${run}`).length === 1, JSON.stringify(again.body));
await mock('/admin/status', { messageId: sentRecord.inventiveChatMessageId, status: 'delivered' });
await mock('/admin/status', { messageId: sentRecord.inventiveChatMessageId, status: 'sent' });
assert('statuses only move forward: a late "sent" after "delivered" changes nothing', (await messageBy('{ id: { eq: $value } }', { value: clientMessageId }))?.status === 'DELIVERED', '');

// 5b. Sends InventiveChat cannot confirm are failed with the reason, never retried with the same key, and can be sent
// again on purpose under a new key.
const UNCONFIRMED = /could not confirm whether WhatsApp accepted/;
const sendsOf = async (text) => (await mockLog('/v1/messages/send')).filter((entry) => entry.body?.payload?.body === text);
const outcomeEvents = async (key) => (await mock('/admin/emitted')).filter((entry) => entry.type === 'message.send_outcome_unknown' && entry.data.idempotency_key === key);
const timedOutId = randomUUID();
await mock('/admin/unknown-next', {});
const timedOut = await api({ action: 'send', conversationId: knownConversation.id, text: `Maybe sent ${run}`, clientMessageId: timedOutId });
const timedOutRecord = await messageBy('{ id: { eq: $value } }', { value: timedOutId });
assert('a 502 outcome_unknown fails the message with the reason and is not sent again on its own', timedOut.status >= 400 && UNCONFIRMED.test(JSON.stringify(timedOut.body)) && timedOutRecord?.status === 'FAILED' && UNCONFIRMED.test(timedOutRecord.error ?? '') && (await sendsOf(`Maybe sent ${run}`)).length === 1, JSON.stringify({ timedOut, timedOutRecord }));
const timedOutEvent = await waitFor('the outcome_unknown webhook', async () => (await outcomeEvents(timedOutRecord?.idempotencyKey))[0], 10_000).catch(() => null);
assert('its webhook is accepted and leaves the message failed with the same reason', timedOutEvent?.results?.[0]?.status === 200 && timedOutEvent.actor.type === 'system' && (await messageBy('{ id: { eq: $value } }', { value: timedOutId }))?.status === 'FAILED', JSON.stringify(timedOutEvent));
const resent = await api({ action: 'send', conversationId: knownConversation.id, text: `Maybe sent ${run}`, clientMessageId: timedOutId });
const resentSends = await sendsOf(`Maybe sent ${run}`);
const resentRecord = await messageBy('{ id: { eq: $value } }', { value: timedOutId });
assert('sending it again on purpose uses a new idempotency key and goes out', resent.status === 200 && resentSends.length === 2 && resentSends[0].body.idempotency_key !== resentSends[1].body.idempotency_key && resentRecord?.status === 'SENT' && !resentRecord.error, JSON.stringify({ resent, resentRecord, keys: resentSends.map((entry) => entry.body.idempotency_key) }));

const crashedId = randomUUID();
await mock('/admin/unknown-next', { crash: true });
const crashed = await api({ action: 'send', conversationId: knownConversation.id, text: `Crashed ${run}`, clientMessageId: crashedId });
const crashedSends = await sendsOf(`Crashed ${run}`);
const crashedRecord = await messageBy('{ id: { eq: $value } }', { value: crashedId });
assert('a send cut off mid-request is retried once with the same key, which InventiveChat answers outcome_unknown', UNCONFIRMED.test(JSON.stringify(crashed.body)) && crashedSends.length === 2 && crashedSends[0].body.idempotency_key === crashedSends[1].body.idempotency_key && crashedRecord?.status === 'FAILED', JSON.stringify({ crashed, crashedRecord, sends: crashedSends.length }));
const crashEvent = await waitFor('the crash notification', async () => (await outcomeEvents(crashedRecord?.idempotencyKey))[0], 10_000).catch(() => null);
assert("InventiveChat's crash notice (its own actor, a new correlation id) is matched by our key and accepted", crashEvent?.results?.[0]?.status === 200 && crashEvent.actor.id === 'messaging-service' && /"message"/.test(crashEvent.results[0].body), JSON.stringify(crashEvent));
const strangerKey = await mock('/admin/emit', { type: 'message.send_outcome_unknown', data: { conversation_id: knownInbound.conversationId, idempotency_key: `crm_not_ours_${run}`, detail: 'x' } });
assert('a notice for a send that is not ours is accepted and ignored, so it is not retried', strangerKey.results?.[0]?.status === 200 && /unknown message/.test(strangerKey.results[0].body), JSON.stringify(strangerKey.results?.[0]));
await api({ action: 'markRead', conversationId: knownConversation.id });
assert('marking read clears the unread count', (await conversationByIcId(knownInbound.conversationId)).unreadCount === 0, '');
const assigned = await api({ action: 'assign', conversationId: knownConversation.id });
const closed = await api({ action: 'close', conversationId: knownConversation.id });
const afterActions = await conversationByIcId(knownInbound.conversationId);
assert('assign to me and close work', assigned.status === 200 && closed.status === 200 && afterActions.assigneeId === adminMemberId && afterActions.status === 'CLOSED', JSON.stringify(afterActions));
await mock('/admin/inbound', { phone: knownPhone, text: `One more thing ${run}` });
assert('a new message from the customer reopens the conversation', (await conversationByIcId(knownInbound.conversationId)).status === 'OPEN', '');

// 6. Outside the 24-hour window only templates go out; a person is messaged with a template.
const oldPhone = phoneOf('03');
const oldInbound = await mock('/admin/inbound', { phone: oldPhone, text: 'Old message', at: new Date(Date.now() - 2 * 86_400_000).toISOString() });
const oldConversation = await conversationByIcId(oldInbound.conversationId);
const lateText = await api({ action: 'send', conversationId: oldConversation.id, text: 'Too late for free text' });
assert('free text outside the 24-hour window is refused before reaching InventiveChat', lateText.status === 409 && !(await mockLog('/v1/messages/send')).some((entry) => entry.body?.payload?.body === 'Too late for free text'), JSON.stringify(lateText));
const templates = await api({ action: 'templates' });
const reminder = templates.body?.templates?.find((template) => template.name === 'appointment_reminder');
const draft = templates.body?.templates?.find((template) => template.name === 'draft_template');
assert('templates come with their named parameters, and ones not approved are listed with their status', templates.status === 200 && reminder?.language === 'en_GB' && JSON.stringify(reminder.parameters) === '["customer_name","day"]' && draft?.status === 'pending' && templates.body.templates[0].status === 'approved', JSON.stringify(templates.body));
const personPhone = phoneOf('04');
const prospect = (await gql(`mutation($data: PersonCreateInput!) { createPerson(data: $data) { id } }`, { data: { name: { firstName: 'Pat', lastName: `Prospect${run}` }, phones: { primaryPhoneNumber: personPhone.slice(3), primaryPhoneCallingCode: '+44', primaryPhoneCountryCode: 'GB' } } })).createPerson;
const textToPerson = await api({ action: 'send', personId: prospect.id, text: 'Hi' });
assert('a conversation the business starts cannot be free text', textToPerson.status === 400, JSON.stringify(textToPerson));
const templateToPerson = await api({ action: 'send', personId: prospect.id, template: { name: 'appointment_reminder', languageCode: 'en_GB', parameters: { customer_name: 'Pat', day: 'Friday' } } });
const toPhone = (await mockLog('/v1/messages/send-to-phone')).find((entry) => entry.body?.payload?.to === personPhone);
const prospectConversation = templateToPerson.body?.message?.conversationId ? first((await gql(`query($id: UUID) { whatsappConversations(filter: { id: { eq: $id } }) { edges { node { ${CONVERSATION} } } } }`, { id: templateToPerson.body.message.conversationId })).whatsappConversations) : null;
assert('a template to a person starts the conversation through send-to-phone, with named parameters, on behalf of the sender', templateToPerson.status === 200 && toPhone?.body.payload.type === 'template' && toPhone.body.payload.template.parameters.day === 'Friday' && toPhone.body.payload.whatsapp_account_id === 'wac_1' && toPhone.body.payload.on_behalf_of?.crm_member_id === adminMemberId && prospectConversation?.personId === prospect.id, JSON.stringify({ templateToPerson, toPhone }));
const missingValue = await api({ action: 'send', personId: prospect.id, template: { name: 'appointment_reminder', languageCode: 'en_GB', parameters: { customer_name: 'Pat' } } });
assert('InventiveChat’s own refusal of an incomplete template is shown plainly', missingValue.status === 422 && /template\.parameters\.day is required/.test(missingValue.body?.error ?? ''), JSON.stringify(missingValue));

// 7. API keys and anonymous callers cannot use the signed-in route.
const withApiKey = await api({ action: 'templates' }, apiKey);
const anonymous = await api({ action: 'templates' }, null);
assert('the inbox route needs a signed-in person, not just an API key', withApiKey.status === 403 && (anonymous.status === 401 || anonymous.status === 403), `${withApiKey.status} ${anonymous.status}`);

// 8. The gateway bridge speaks WHATSAPP_HANDOFF.md and fills templates by parameter name.
const invoicePhone = phoneOf('05');
const deliveryId = randomUUID();
const invoiceRequest = {
  event: 'invoice.send',
  deliveryId,
  business: { name: 'Acme Plumbing & Heating', replyEmail: 'accounts@acme.test' },
  recipient: { name: 'Ivy Invoice', phone: invoicePhone, whatsappOptIn: true },
  document: { type: 'INVOICE', number: `ACME-${run}`, total: { amountPence: 11400, currency: 'GBP', formatted: '£114.00' }, amountDue: { amountPence: 11400, currency: 'GBP', formatted: '£114.00' }, issueDate: '2026-11-03', dueDate: '2026-11-17', validUntil: null, pdf: { url: `${W}/file/x`, filename: 'Invoice.pdf' }, paymentUrl: null },
  statusCallbackUrl: `${W}/s/whatsapp/status`,
};
const wrongSignature = await gateway(invoiceRequest, { secret: 'not-the-secret' });
const staleSignature = await gateway(invoiceRequest, { timestamp: Math.floor(Date.now() / 1000) - 600 });
const foreignCallback = await gateway({ ...invoiceRequest, deliveryId: randomUUID(), statusCallbackUrl: 'https://evil.example/s/whatsapp/status' });
assert('the gateway refuses bad or stale signatures and callbacks to other hosts', wrongSignature.status === 401 && staleSignature.status === 401 && foreignCallback.status === 400, `${wrongSignature.status} ${staleSignature.status} ${foreignCallback.status}`);
const invoiceSent = await gateway(invoiceRequest);
const invoiceAgain = await gateway(invoiceRequest);
const invoiceCalls = (await mockLog('/v1/messages/send-to-phone')).filter((entry) => entry.body?.payload?.to === invoicePhone);
const invoiceParameters = invoiceCalls[0]?.body.payload.template.parameters;
assert('invoice.send goes out once with the default mapping; a repeat answers with the same message', invoiceSent.status === 200 && invoiceSent.body.messageId && invoiceAgain.body?.messageId === invoiceSent.body.messageId && invoiceCalls.length === 1 && invoiceCalls[0].body.payload.template.name === 'invoice_ready' && invoiceParameters?.invoice_number === `ACME-${run}` && invoiceParameters.customer_name === 'Ivy' && invoiceParameters.amount_due === '£114.00' && !invoiceCalls[0].body.payload.on_behalf_of, JSON.stringify({ invoiceSent, invoiceCalls }));
const unmapped = await gateway({ ...invoiceRequest, event: 'quote.send', deliveryId: randomUUID() });
assert('an event whose template is not approved in InventiveChat is refused with the reason', unmapped.status === 422 && /quote_ready/.test(unmapped.body?.error ?? ''), JSON.stringify(unmapped));

// The status goes back to the caller signed; Quotes & Invoices' own route checks it, when that app is installed.
const delivery = await gql(`mutation($data: DocumentDeliveryCreateInput!) { createDocumentDelivery(data: $data) { id } }`, { data: { name: `WhatsApp test ${run}`, channel: 'WHATSAPP', status: 'SENT' } })
  .then((result) => result.createDocumentDelivery)
  .catch(() => null);
if (delivery) {
  const forwarded = await gateway({ ...invoiceRequest, deliveryId: delivery.id, recipient: { ...invoiceRequest.recipient, phone: phoneOf('06') } });
  await mock('/admin/status', { messageId: forwarded.body?.messageId, status: 'delivered' });
  const updated = await waitFor('the delivery to be marked delivered', async () => {
    const node = first((await gql(`query($id: UUID) { documentDeliveries(filter: { id: { eq: $id } }) { edges { node { status providerMessageId } } } }`, { id: delivery.id })).documentDeliveries);
    return node?.status === 'DELIVERED' ? node : null;
  }, 15_000).catch(() => null);
  assert('a delivery update is forwarded, signed, to the calling app’s status callback', Boolean(updated), JSON.stringify(forwarded));
} else skip('status forwarded to Quotes & Invoices', 'that app is not installed in this workspace');

// A teammate who took the customer over holds notifications back until they hand the conversation back.
const busyPhone = phoneOf('07');
await mock('/admin/takeover', { phone: busyPhone });
const heldDelivery = randomUUID();
const held = await gateway({ ...invoiceRequest, deliveryId: heldDelivery, recipient: { ...invoiceRequest.recipient, phone: busyPhone } });
const heldRecord = await messageBy('{ deliveryId: { eq: $value } }', { value: heldDelivery });
assert('a 423 human_active is reported as accepted and queued, waiting for the teammate, not on a short timer', held.status === 202 && held.body.queued === true && heldRecord?.status === 'QUEUED' && heldRecord.waitingFor === 'person' && Date.parse(heldRecord.retryAt) > Date.now() + 23 * 3600_000, JSON.stringify({ held, heldRecord }));
const handBack = await mock('/admin/hand-back', { phone: busyPhone });
const released = await messageBy('{ deliveryId: { eq: $value } }', { value: heldDelivery });
assert('the hand-back (conversation.updated) releases it to the retry job', handBack.results?.[0]?.status === 200 && Date.parse(released?.retryAt) <= Date.now(), JSON.stringify({ handBack: handBack.results?.[0], released }));
const retryRun = await route('/whatsapp/retry', {});
const retried = await messageBy('{ deliveryId: { eq: $value } }', { value: heldDelivery });
assert('the retry job sends it with the same idempotency key', retryRun.status === 200 && retried?.status === 'SENT' && retried.inventiveChatMessageId && retried.idempotencyKey === heldRecord.idempotencyKey, JSON.stringify({ retryRun, retried }));

// An outcome_unknown notice for a notification still waiting stops it being retried.
const waitingPhone = phoneOf('11');
await mock('/admin/takeover', { phone: waitingPhone });
const waitingDelivery = randomUUID();
await gateway({ ...invoiceRequest, deliveryId: waitingDelivery, recipient: { ...invoiceRequest.recipient, phone: waitingPhone } });
const waitingRecord = await messageBy('{ deliveryId: { eq: $value } }', { value: waitingDelivery });
await mock('/admin/emit', { type: 'message.send_outcome_unknown', data: { conversation_id: null, idempotency_key: waitingRecord?.idempotencyKey, detail: 'The sending process stopped mid-send.' } });
const unconfirmedNotice = await messageBy('{ deliveryId: { eq: $value } }', { value: waitingDelivery });
assert('a waiting notification whose outcome became unknown is failed with the reason and taken off the retry queue', waitingRecord?.status === 'QUEUED' && unconfirmedNotice?.status === 'FAILED' && UNCONFIRMED.test(unconfirmedNotice.error ?? '') && unconfirmedNotice.retryAt === null, JSON.stringify({ waitingRecord, unconfirmedNotice }));

// Campaign batches: consent recorded first, values filled by parameter name, each recipient once.
const campaignId = randomUUID();
const ann = { recipientId: randomUUID(), to: phoneOf('08'), variables: ['Ann', '20%'] };
const stopped = { recipientId: randomUUID(), to: phoneOf('09'), variables: ['Stan', '20%'] };
await mock('/admin/opt-out', { phone: stopped.to });
const batch = { event: 'campaign.message', campaignId, batchId: `${campaignId}:${randomUUID()}`, template: { name: 'spring_offer', language: 'en_GB' }, messages: [ann, stopped], statusCallbackUrl: `${W}/s/campaigns/whatsapp/status` };
const batchSent = await gateway(batch);
const batchAgain = await gateway(batch);
const consent = (await mockLog('/v1/contacts/consent')).filter((entry) => entry.body?.payload?.phone === ann.to);
const annSends = (await mockLog('/v1/messages/send-to-phone')).filter((entry) => entry.body?.payload?.to === ann.to);
assert('a campaign batch records consent, fills the named parameters, sends each recipient once and skips a customer who sent STOP', batchSent.status === 200 && batchSent.body.accepted.length === 1 && batchSent.body.accepted[0].recipientId === ann.recipientId && consent[0]?.body.payload.consent === true && consent[0].body.payload.source === 'crm' && annSends.length === 1 && annSends[0].body.payload.template.parameters.first_name === 'Ann' && annSends[0].body.payload.template.parameters.discount === '20%', JSON.stringify({ batchSent, consent: consent.length, annSends }));
assert('a repeated batch is answered from what was already sent', batchAgain.status === 200 && JSON.stringify(batchAgain.body.accepted) === JSON.stringify(batchSent.body.accepted) && (await mockLog('/v1/messages/send-to-phone')).filter((entry) => entry.body?.payload?.to === ann.to).length === 1, JSON.stringify(batchAgain.body));

// 9. Opt-outs and conversation state from InventiveChat.
await gql(`mutation($id: UUID!, $data: PersonUpdateInput!) { updatePerson(id: $id, data: $data) { id } }`, { id: known.id, data: { whatsappMarketingConsent: true } }).catch(() => null);
const optOut = await mock('/admin/emit', { type: 'customer.opted_out', data: { customer: knownPhone.slice(1), profile_name: 'Someone Else' } });
const optedConversation = await conversationByIcId(knownInbound.conversationId);
assert('an opt-out marks the conversation', optOut.results[0].status === 200 && optedConversation.optedOut === true, JSON.stringify(optOut.results[0]));
const consentField = await gql(`query($id: UUID) { people(filter: { id: { eq: $id } }) { edges { node { id whatsappMarketingConsent } } } }`, { id: known.id }).catch(() => null);
if (consentField) assert('an opt-out withdraws WhatsApp marketing consent on the person', first(consentField.people)?.whatsappMarketingConsent === false, JSON.stringify(first(consentField.people)));
else skip('consent withdrawn on the person', 'Campaign Studio is not installed, so the field does not exist');
const optedSend = await api({ action: 'send', conversationId: knownConversation.id, text: 'Are you still there?' });
assert('nothing is sent to a customer who opted out', optedSend.status === 409, JSON.stringify(optedSend));
const approval = await mock('/admin/approve', { conversationId: unknown.conversationId });
const stateConversation = await conversationByIcId(unknown.conversationId);
assert('conversation.updated shows the AI replying and that the customer is waiting', approval.results?.[0]?.status === 200 && stateConversation.handling === 'AI' && stateConversation.customerWaiting === true, JSON.stringify(stateConversation));

// 10. Live updates: the app announces its writes to the hub and hands the browser a signed token.
const publishes = await mock('/admin/publishes');
if (vars.REALTIME_SECRET && publishes.length > 0) {
  const touched = publishes.flatMap((entry) => entry.events ?? []).flatMap((event) => event.ids);
  assert('every write is announced to the realtime hub, signed', publishes.every((entry) => entry.validSignature === true && entry.topic === 'whatsapp') && touched.includes(knownConversation.id) && touched.includes(clientMessageId), JSON.stringify(publishes.slice(0, 2)));
  const token = await api({ action: 'realtimeToken' });
  const [version, payload, signature] = (token.body?.token ?? '').split('.');
  const claims = payload ? JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) : null;
  assert('the browser gets a signed, hour-long token for its member and the whatsapp topic', version === 'v1' && signature === createHmac('sha256', vars.REALTIME_SECRET).update(`v1.${payload}`).digest('base64url') && claims?.member === adminMemberId && claims.topics.includes('whatsapp') && token.body.url.endsWith('/v1/stream'), JSON.stringify(token.body));
} else skip('realtime publishes', 'REALTIME_INTERNAL_URL and REALTIME_SECRET are not set for the app on this server');

// 11. The workflow action and AI tool, called as an AI tool over MCP with the API key.
const rpc = async (method, params) => {
  const response = await fetch(`${SERVER_URL}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }) });
  const text = await response.text();
  return JSON.parse(text.startsWith('{') ? text : text.split('\n').filter((line) => line.startsWith('data:')).pop().slice(5));
};
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }).catch(() => null);
let toolName = null;
const callTool = async (args) => {
  for (const name of toolName ? [toolName] : ['app_send_whatsapp_message', 'app_send-whatsapp-message']) {
    const text = (await rpc('tools/call', { name: 'execute_tool', arguments: { toolName: name, arguments: args } }).catch(() => null))?.result?.content?.[0]?.text ?? '';
    if (/success/.test(text)) {
      toolName = name;
      return text;
    }
  }
  return null;
};
const noTopic = await callTool({ personId: createdPerson?.id, text: `No topic ${run}` });
if (noTopic) {
  assert('automation free text without a topic is refused plainly', /needs a topic/.test(noTopic) && !(await mockLog('/v1/messages/send')).some((entry) => entry.body?.payload?.body === `No topic ${run}`), noTopic);
  const outOfScope = await callTool({ personId: createdPerson?.id, text: `Off topic ${run}`, topic: 'bookings' });
  assert('a topic InventiveChat does not allow is refused with the allowed topics', /Allowed topics: none yet/.test(outOfScope ?? ''), outOfScope);
  await mock('/admin/allow-topic', { topic: 'bookings' });
  const automated = await callTool({ personId: createdPerson?.id, text: `Automated hello ${run}`, topic: 'bookings' });
  const claims = await mockLog(`/v1/conversations/${unknown.conversationId}/claim`);
  const automatedSend = (await mockLog('/v1/messages/send')).find((entry) => entry.body?.payload?.body === `Automated hello ${run}`);
  assert('the AI tool claims the conversation for the latest message and replies on the topic', /Sent as a reply/.test(automated ?? '') && claims.at(-1)?.body.payload.claimant === 'ai' && claims.at(-1).body.payload.latest_message_id === unknown.messageId && automatedSend?.body.payload.claim_id && automatedSend.body.payload.topic === 'bookings' && !automatedSend.body.payload.on_behalf_of, JSON.stringify({ automated, automatedSend }));
  const releases = (await mockLog(`/v1/conversations/${unknown.conversationId}/release`)).map((entry) => entry.body.payload.claim_id);
  const refusedSend = (await mockLog('/v1/messages/send')).find((entry) => entry.body?.payload?.body === `Off topic ${run}`);
  assert('the claim is released after a refused send and after a sent reply', releases.includes(refusedSend?.body.payload.claim_id) && releases.includes(automatedSend?.body.payload.claim_id) && (await mock('/admin/claims', { conversationId: unknown.conversationId })).length === 0, JSON.stringify({ releases, refused: refusedSend?.body.payload.claim_id, sent: automatedSend?.body.payload.claim_id }));
  const followUp = await callTool({ personId: createdPerson?.id, text: `Automated follow-up ${run}`, topic: 'bookings' });
  assert('so a second automated reply straight after is not blocked by the first claim', /Sent as a reply/.test(followUp ?? ''), followUp);
  const fresh = (await gql(`mutation($data: PersonCreateInput!) { createPerson(data: $data) { id } }`, { data: { name: { firstName: 'Tia', lastName: `Tool${run}` }, phones: { primaryPhoneNumber: phoneOf('10').slice(3), primaryPhoneCallingCode: '+44', primaryPhoneCountryCode: 'GB' } } })).createPerson;
  const templated = await callTool({ personId: fresh.id, templateName: 'appointment_reminder', parameters: { customer_name: 'Tia', day: 'Monday' } });
  assert('the AI tool sends a template by default', /Template appointment_reminder sent/.test(templated ?? ''), templated);
  // The admin's template to Pat took that conversation over, so an automated one waits for them.
  const queued = await callTool({ personId: prospect.id, templateName: 'appointment_reminder', parameters: { customer_name: 'Pat', day: 'Monday' } });
  assert('an automated template to a customer a teammate is handling is queued, not failed', /Queued/.test(queued ?? '') && /teammate/.test(queued ?? ''), queued);
} else skip('workflow action and AI tool', 'the tool could not be reached over MCP on this server');

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
