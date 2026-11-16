// Test double for the Resend API and the InventiveChat WhatsApp gateway, for the throwaway test server only.
// Usage: WHATSAPP_GATEWAY_SECRET=... node mock-resend.mjs [port]
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8097);
let emails = [];
let whatsapp = [];
let log = [];
let webhooks = [];
let failNext = null;
const idempotent = new Map();
let counter = 0;

const DOMAINS = [
  { id: 'dom_1', name: 'acme-mail.test', status: 'verified', open_tracking: true, click_tracking: true, region: 'eu-west-1' },
  { id: 'dom_2', name: 'pending.test', status: 'pending', open_tracking: false, click_tracking: false, region: 'eu-west-1' },
];

const send = (response, status, body, headers = {}) => {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
};

// The same address always gets the same secret, so a restarted double still matches what the app has stored.
const signingSecret = (endpoint) => `whsec_${createHash('sha256').update(`mock:${endpoint}`).digest('base64')}`;

const authorised = (request) => /^Bearer re_good[A-Za-z0-9_]+$/.test(request.headers.authorization ?? '');

createServer(async (request, response) => {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const body = raw ? JSON.parse(raw) : null;
  const url = new URL(request.url, 'http://mock');
  log.push({ method: request.method, path: url.pathname, idempotencyKey: request.headers['idempotency-key'] ?? null });

  if (url.pathname.startsWith('/admin/')) {
    if (url.pathname === '/admin/reset') {
      emails = [];
      whatsapp = [];
      log = [];
      failNext = null;
      idempotent.clear();
      return send(response, 200, { ok: true });
    }
    if (url.pathname === '/admin/fail-next') {
      failNext = { path: body.path ?? '/emails/batch', skip: body.skip ?? 0 };
      return send(response, 200, { ok: true });
    }
    if (url.pathname === '/admin/emails') return send(response, 200, emails);
    if (url.pathname === '/admin/whatsapp') return send(response, 200, whatsapp);
    if (url.pathname === '/admin/log') return send(response, 200, log);
    if (url.pathname === '/admin/webhooks') return send(response, 200, webhooks);
  }

  if (url.pathname === '/whatsapp' && request.method === 'POST') {
    const timestamp = request.headers['x-inventivecrm-timestamp'];
    const expected = `sha256=${createHmac('sha256', process.env.WHATSAPP_GATEWAY_SECRET ?? '').update(`${timestamp}.${raw}`).digest('hex')}`;
    if (request.headers['x-inventivecrm-signature'] !== expected) return send(response, 401, { error: 'bad signature' });
    whatsapp.push(body);
    return send(response, 200, { accepted: body.messages.filter((message) => message.to !== '+447000000000').map((message) => ({ recipientId: message.recipientId, messageId: `wamid.${++counter}` })) });
  }

  if (!authorised(request)) return send(response, 401, { name: 'restricted_api_key', message: 'This API key is restricted.' });

  if (failNext && failNext.path === url.pathname) {
    if (failNext.skip > 0) failNext.skip -= 1;
    else {
      failNext = null;
      return send(response, 429, { name: 'rate_limit_exceeded', message: 'Too many requests.' }, { 'retry-after': '1' });
    }
  }

  if (request.method === 'GET' && url.pathname === '/domains') return send(response, 200, { object: 'list', has_more: false, data: DOMAINS });
  if (request.method === 'GET' && url.pathname === '/webhooks') return send(response, 200, { object: 'list', data: webhooks });
  if (request.method === 'POST' && url.pathname === '/webhooks') {
    webhooks.push({ id: `wh_${++counter}`, endpoint: body.endpoint, events: body.events });
    return send(response, 200, { object: 'webhook', id: `wh_${counter}`, signing_secret: signingSecret(body.endpoint) });
  }
  const webhook = request.method === 'GET' && webhooks.find((entry) => url.pathname === `/webhooks/${entry.id}`);
  if (webhook) return send(response, 200, { object: 'webhook', status: 'enabled', ...webhook, signing_secret: signingSecret(webhook.endpoint) });

  if (request.method === 'POST' && (url.pathname === '/emails/batch' || url.pathname === '/emails')) {
    const key = request.headers['idempotency-key'];
    if (key && idempotent.has(key)) return send(response, 200, idempotent.get(key));
    const batch = url.pathname === '/emails/batch' ? body : [body];
    if (batch.length > 100) return send(response, 422, { name: 'validation_error', message: 'Too many emails.' });
    if (batch.some((email) => email.to.some((address) => address.startsWith('reject@')))) return send(response, 422, { name: 'validation_error', message: 'Invalid `to` field.' });
    if (batch.some((email) => !email.from || !email.subject || !email.html)) return send(response, 422, { name: 'validation_error', message: 'Missing fields.' });
    const ids = batch.map((email) => {
      const id = randomUUID();
      emails.push({ id, ...email });
      return { id };
    });
    const result = url.pathname === '/emails/batch' ? { data: ids } : ids[0];
    if (key) idempotent.set(key, result);
    return send(response, 200, result);
  }

  send(response, 404, { name: 'not_found', message: `${request.method} ${url.pathname}` });
}).listen(port, '127.0.0.1', () => console.log(`mock resend on ${port}`));
