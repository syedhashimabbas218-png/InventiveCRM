#!/usr/bin/env node
// Stand-in for the WhatsApp (WABA) service: checks the signature, records the request, answers with a message id,
// then reports "delivered" and "read" to the status callback the way the real service should.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const secret = process.env.WHATSAPP_GATEWAY_SECRET;
const port = Number(process.env.PORT || 8090);
const log = process.env.LOG_FILE || 'whatsapp-gateway.log';
if (!secret) throw new Error('Set WHATSAPP_GATEWAY_SECRET');

const sign = (timestamp, body) => `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

const isSigned = (timestamp, signature, body) => {
  if (!timestamp || !signature || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = Buffer.from(sign(timestamp, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
};

const callback = (url, payload) => sendCallback(url, payload).catch((error) => appendFileSync(log, `${JSON.stringify({ callbackError: error.message, url })}\n`));

const sendCallback = async (url, payload) => {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-InventiveCRM-Timestamp': timestamp, 'X-InventiveCRM-Signature': sign(timestamp, body) },
    body,
  });
  appendFileSync(log, `${JSON.stringify({ callback: payload.status, deliveryId: payload.deliveryId, answer: response.status })}\n`);
};

createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    if (!isSigned(request.headers['x-inventivecrm-timestamp'], request.headers['x-inventivecrm-signature'], body)) {
      appendFileSync(log, `${JSON.stringify({ rejected: 'bad signature' })}\n`);
      response.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'bad signature' }));
      return;
    }
    const message = JSON.parse(body);
    const messageId = `wamid.${randomUUID()}`;
    appendFileSync(log, `${JSON.stringify({ received: message, messageId })}\n`);
    response.writeHead(202, { 'Content-Type': 'application/json' }).end(JSON.stringify({ messageId }));
    setTimeout(() => callback(message.statusCallbackUrl, { deliveryId: message.deliveryId, messageId, status: 'delivered' }), 1500);
    setTimeout(() => callback(message.statusCallbackUrl, { deliveryId: message.deliveryId, messageId, status: 'read' }), 3000);
  });
}).listen(port, '127.0.0.1', () => console.log(`mock WhatsApp gateway on 127.0.0.1:${port}`));
