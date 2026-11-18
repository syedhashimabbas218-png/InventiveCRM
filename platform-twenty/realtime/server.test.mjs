import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createStreamToken, publishSignature, startRealtimeServer, verifyStreamToken } from './server.mjs';

const SECRET = 's'.repeat(40);
const WORKSPACE = '7f1c2e9a-0000-4000-8000-000000000001';
const OTHER_WORKSPACE = '7f1c2e9a-0000-4000-8000-000000000002';
const MEMBER = '9a1b0c3d-0000-4000-8000-000000000003';
const hour = () => Math.floor(Date.now() / 1000) + 3600;

let realtime;
let base;

before(async () => {
  realtime = await startRealtimeServer({ REALTIME_SECRET: SECRET, REALTIME_HOST: '127.0.0.1', REALTIME_PORT: '0', REALTIME_HEARTBEAT_MS: '200', REALTIME_MAX_STREAMS_PER_MEMBER: '3' });
  base = `http://127.0.0.1:${realtime.port}`;
});

after(() => realtime.close());

const publish = (body, { secret = SECRET, timestamp = Math.floor(Date.now() / 1000) } = {}) => {
  const raw = JSON.stringify(body);
  return fetch(`${base}/v1/publish`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-realtime-timestamp': String(timestamp), 'x-realtime-signature': publishSignature(secret, timestamp, raw) }, body: raw });
};

// Reads server-sent events from a stream until `count` frames of the wanted kinds arrived, or the time runs out.
const listen = async (url, { headers = {}, count = 1, kinds = ['change', 'resync', 'expired'], timeoutMs = 2000 } = {}) => {
  const controller = new AbortController();
  const response = await fetch(url, { headers, signal: controller.signal });
  const frames = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    while (frames.length < count) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffered.indexOf('\n\n')) >= 0) {
        const block = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        const fields = Object.fromEntries(block.split('\n').filter((line) => !line.startsWith(':') && line.includes(':')).map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()]));
        if (fields.event && kinds.includes(fields.event)) frames.push({ event: fields.event, id: fields.id, data: fields.data ? JSON.parse(fields.data) : null });
      }
    }
  } catch {
    // Aborted by the timer: return what arrived.
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return { response, frames };
};

const streamUrl = (claims, extra = '') => `${base}/v1/stream?token=${encodeURIComponent(createStreamToken(SECRET, claims))}${extra}`;

describe('stream passes', () => {
  it('accepts its own pass and refuses altered, expired or foreign ones', () => {
    const claims = { workspace: WORKSPACE, member: MEMBER, topics: ['whatsapp'], exp: hour() };
    const token = createStreamToken(SECRET, claims);
    assert.deepEqual(verifyStreamToken(SECRET, token), claims);
    assert.equal(verifyStreamToken('x'.repeat(40), token), null);
    const [version, payload, signature] = token.split('.');
    const altered = Buffer.from(JSON.stringify({ ...claims, workspace: OTHER_WORKSPACE })).toString('base64url');
    assert.equal(verifyStreamToken(SECRET, `${version}.${altered}.${signature}`), null);
    assert.equal(verifyStreamToken(SECRET, createStreamToken(SECRET, { ...claims, exp: Math.floor(Date.now() / 1000) - 1 })), null);
    assert.equal(verifyStreamToken(SECRET, `${version}.${payload}`), null);
    assert.equal(verifyStreamToken(SECRET, 'nonsense'), null);
  });
});

describe('live notices', () => {
  it('delivers a change to its own workspace and topic only, within the same moment', async () => {
    const mine = listen(streamUrl({ workspace: WORKSPACE, member: MEMBER, topics: ['whatsapp'], exp: hour() }));
    const otherWorkspace = listen(streamUrl({ workspace: OTHER_WORKSPACE, member: MEMBER, topics: ['whatsapp'], exp: hour() }), { timeoutMs: 600 });
    const otherTopic = listen(streamUrl({ workspace: WORKSPACE, member: MEMBER, topics: ['chat'], exp: hour() }), { timeoutMs: 600 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const sentAt = Date.now();
    const published = await publish({ workspace: WORKSPACE, topic: 'whatsapp', events: [{ kind: 'message', ids: ['m1', 'm2'] }] });
    assert.equal(published.status, 202);
    const received = await mine;
    assert.equal(received.response.headers.get('content-type'), 'text/event-stream');
    assert.equal(received.response.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(received.frames[0].data.ids, ['m1', 'm2']);
    assert.equal(received.frames[0].data.kind, 'message');
    assert.ok(Date.now() - sentAt < 500);
    assert.equal((await otherWorkspace).frames.length, 0);
    assert.equal((await otherTopic).frames.length, 0);
  });

  it('replays what a reconnecting screen missed, and asks for a resync when the gap is unknown', async () => {
    const claims = { workspace: WORKSPACE, member: MEMBER, topics: ['whatsapp'], exp: hour() };
    const first = listen(streamUrl(claims));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await publish({ workspace: WORKSPACE, topic: 'whatsapp', events: [{ kind: 'conversation', ids: ['c1'] }] });
    const seen = (await first).frames[0];
    await publish({ workspace: WORKSPACE, topic: 'whatsapp', events: [{ kind: 'conversation', ids: ['c2'] }, { kind: 'message', ids: ['m3'] }] });
    const resumed = await listen(streamUrl(claims), { headers: { 'Last-Event-ID': seen.id }, count: 2 });
    assert.deepEqual(resumed.frames.map((frame) => frame.data.ids[0]), ['c2', 'm3']);
    const tooOld = await listen(streamUrl(claims, '&lastEventId=1'));
    assert.equal(tooOld.frames[0].event, 'resync');
  });

  it('tells a screen when its pass runs out, so it can fetch a new one', async () => {
    const { frames } = await listen(streamUrl({ workspace: WORKSPACE, member: MEMBER, topics: ['whatsapp'], exp: Math.floor(Date.now() / 1000) + 1 }), { timeoutMs: 2500 });
    assert.equal(frames[0]?.event, 'expired');
  });

  it('sends heartbeats so proxies and screens know the line is alive', async () => {
    const controller = new AbortController();
    const response = await fetch(streamUrl({ workspace: WORKSPACE, member: MEMBER, topics: ['whatsapp'], exp: hour() }), { signal: controller.signal });
    const reader = response.body.getReader();
    let text = '';
    const deadline = Date.now() + 1500;
    while (!text.includes(': ping') && Date.now() < deadline) text += new TextDecoder().decode((await reader.read()).value);
    controller.abort();
    assert.ok(text.includes(': ping'));
  });
});

describe('refusals', () => {
  it('refuses streams without a valid pass or outside its topics, and caps streams per person', async () => {
    assert.equal((await fetch(`${base}/v1/stream`)).status, 401);
    assert.equal((await fetch(`${base}/v1/stream?token=v1.abc.def`)).status, 401);
    assert.equal((await fetch(streamUrl({ workspace: WORKSPACE, member: MEMBER, topics: ['payroll'], exp: hour() }))).status, 403);
    const member = '9a1b0c3d-0000-4000-8000-0000000000aa';
    const controllers = [];
    const statuses = [];
    for (let index = 0; index < 4; index += 1) {
      const controller = new AbortController();
      controllers.push(controller);
      statuses.push((await fetch(streamUrl({ workspace: WORKSPACE, member, topics: ['whatsapp'], exp: hour() }), { signal: controller.signal })).status);
    }
    for (const controller of controllers) controller.abort();
    assert.deepEqual(statuses, [200, 200, 200, 429]);
  });

  it('refuses unsigned, wrongly signed, stale and malformed publishes', async () => {
    const event = { workspace: WORKSPACE, topic: 'whatsapp', events: [{ kind: 'message', ids: ['m9'] }] };
    assert.equal((await fetch(`${base}/v1/publish`, { method: 'POST', body: JSON.stringify(event) })).status, 401);
    assert.equal((await publish(event, { secret: 'x'.repeat(40) })).status, 401);
    assert.equal((await publish(event, { timestamp: Math.floor(Date.now() / 1000) - 600 })).status, 401);
    assert.equal((await publish({ ...event, topic: 'payroll' })).status, 400);
    assert.equal((await publish({ ...event, events: [{ kind: 'message', ids: ['<script>'] }] })).status, 400);
  });

  it('answers browser preflights for any origin, since app screens run in an opaque sandbox', async () => {
    const response = await fetch(`${base}/v1/stream`, { method: 'OPTIONS', headers: { origin: 'null', 'access-control-request-method': 'GET' } });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
  });
});
