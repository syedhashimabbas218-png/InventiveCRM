#!/usr/bin/env node
// Test double for the Stripe Payment Links and Revolut Merchant order APIs used by Quotes & Invoices. Valid keys are
// rk_test_valid... (Stripe) and sk_sandbox_valid... (Revolut). POST /admin/pay marks a link or order as paid.
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.env.PORT || 8096);
const links = new Map();
const orders = new Map();
const log = [];

const send = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
};
const readBody = (request) => new Promise((resolve) => { let raw = ''; request.on('data', (chunk) => (raw += chunk)); request.on('end', () => resolve(raw)); });
const key = (request) => (request.headers.authorization ?? '').replace(/^Bearer /, '');

createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const raw = await readBody(request);
  if (url.pathname.startsWith('/admin')) {
    const body = raw ? JSON.parse(raw) : {};
    if (url.pathname === '/admin/log') return send(response, 200, log);
    if (url.pathname === '/admin/pay') {
      const target = links.get(body.reference) ?? orders.get(body.reference);
      if (!target) return send(response, 404, {});
      target.paid = true;
      return send(response, 200, { paid: true });
    }
    return send(response, 404, {});
  }

  if (url.pathname.startsWith('/v1/')) {
    if (!key(request).startsWith('rk_test_valid')) return send(response, 401, { error: { message: 'Invalid API Key provided' } });
    const form = Object.fromEntries(new URLSearchParams(raw));
    log.push({ provider: 'stripe', method: request.method, path: url.pathname, idempotencyKey: request.headers['idempotency-key'] ?? null, form });
    if (url.pathname === '/v1/payment_links' && request.method === 'GET') return send(response, 200, { data: [] });
    if (url.pathname === '/v1/payment_links' && request.method === 'POST') {
      const id = `plink_${randomUUID().slice(0, 8)}`;
      links.set(id, { id, amount: Number(form['line_items[0][price_data][unit_amount]']), active: true, paid: false, limit: form['restrictions[completed_sessions][limit]'] });
      return send(response, 200, { id, url: `https://buy.stripe.test/${id}` });
    }
    const update = /^\/v1\/payment_links\/([\w]+)$/.exec(url.pathname);
    if (update && request.method === 'POST') {
      const link = links.get(update[1]);
      if (!link) return send(response, 404, { error: { message: 'No such payment link' } });
      if (form.active === 'false') link.active = false;
      return send(response, 200, { id: link.id, active: link.active });
    }
    if (url.pathname === '/v1/checkout/sessions' && request.method === 'GET') {
      const link = links.get(url.searchParams.get('payment_link'));
      return send(response, 200, { data: link?.paid ? [{ id: `cs_${link.id}`, status: 'complete', payment_status: 'paid', amount_total: link.amount }] : [] });
    }
    return send(response, 404, { error: { message: 'Unknown Stripe endpoint' } });
  }

  if (url.pathname.startsWith('/api/orders')) {
    if (!key(request).startsWith('sk_sandbox_valid')) return send(response, 401, { message: 'Unauthorized' });
    const body = raw ? JSON.parse(raw) : {};
    log.push({ provider: 'revolut', method: request.method, path: url.pathname, version: request.headers['revolut-api-version'] ?? null, body });
    if (url.pathname === '/api/orders' && request.method === 'GET') return send(response, 200, []);
    if (url.pathname === '/api/orders' && request.method === 'POST') {
      const id = randomUUID();
      orders.set(id, { id, amount: body.amount, paid: false, cancelled: false });
      return send(response, 201, { id, state: 'pending', amount: body.amount, currency: body.currency, checkout_url: `https://checkout.revolut.test/payment-link/${id}` });
    }
    const match = /^\/api\/orders\/([\w-]+)(\/cancel)?$/.exec(url.pathname);
    const order = match ? orders.get(match[1]) : null;
    if (!order) return send(response, 404, { message: 'Order not found' });
    if (match[2]) {
      order.cancelled = true;
      return send(response, 200, { id: order.id, state: 'cancelled' });
    }
    return send(response, 200, { id: order.id, amount: order.amount, state: order.paid ? 'completed' : order.cancelled ? 'cancelled' : 'pending' });
  }
  return send(response, 404, {});
}).listen(port, '127.0.0.1', () => console.log(`mock payments on ${port}`));
