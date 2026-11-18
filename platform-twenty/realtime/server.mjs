// Live change notices for the InventiveCRM app screens (Server-Sent Events). App functions publish which records
// changed; open screens hear it at once and re-read those records through Twenty, so permissions still apply there.
// Notices carry ids only. No dependencies: node server.mjs. Settings come from the environment (README.md).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const settings = (environment = process.env) => {
  const secret = environment.REALTIME_SECRET ?? '';
  if (secret.length < 32) throw new Error('REALTIME_SECRET must be at least 32 characters');
  const number = (name, fallback, smallest = 1) => {
    const value = Number(environment[name] ?? fallback);
    if (!Number.isInteger(value) || value < smallest) throw new Error(`${name} must be a whole number of at least ${smallest}`);
    return value;
  };
  return {
    secret,
    host: environment.REALTIME_HOST ?? '0.0.0.0',
    port: number('REALTIME_PORT', 3200, 0),
    topics: new Set((environment.REALTIME_TOPICS ?? 'whatsapp,chat').split(',').map((topic) => topic.trim()).filter(Boolean)),
    maxStreams: number('REALTIME_MAX_STREAMS', 5000),
    maxStreamsPerMember: number('REALTIME_MAX_STREAMS_PER_MEMBER', 20),
    bufferPerWorkspace: number('REALTIME_BUFFER_PER_WORKSPACE', 500),
    heartbeatMs: number('REALTIME_HEARTBEAT_MS', 20_000),
  };
};

const sign = (secret, text) => createHmac('sha256', secret).update(text).digest();

const sameBytes = (left, right) => left.length === right.length && timingSafeEqual(left, right);

const IDENTIFIER = /^[0-9a-zA-Z-]{1,64}$/;

export const createStreamToken = (secret, claims) => {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `v1.${payload}.${sign(secret, `v1.${payload}`).toString('base64url')}`;
};

// Returns the claims of a valid, unexpired token, or null.
export const verifyStreamToken = (secret, token, now = Date.now()) => {
  const [version, payload, signature] = String(token ?? '').split('.');
  if (version !== 'v1' || !payload || !signature) return null;
  if (!sameBytes(Buffer.from(signature, 'base64url'), sign(secret, `v1.${payload}`))) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const valid =
    IDENTIFIER.test(claims?.workspace ?? '') &&
    IDENTIFIER.test(claims?.member ?? '') &&
    Array.isArray(claims.topics) &&
    claims.topics.every((topic) => typeof topic === 'string') &&
    Number.isInteger(claims.exp) &&
    claims.exp * 1000 > now;
  return valid ? claims : null;
};

export const publishSignature = (secret, timestamp, body) => `sha256=${sign(secret, `${timestamp}.${body}`).toString('hex')}`;

const verifyPublish = (secret, headers, body, now = Date.now()) => {
  const timestamp = Number(headers['x-realtime-timestamp']);
  if (!Number.isInteger(timestamp) || Math.abs(now / 1000 - timestamp) > 300) return false;
  const expected = Buffer.from(publishSignature(secret, timestamp, body));
  return sameBytes(Buffer.from(String(headers['x-realtime-signature'] ?? '')), expected);
};

// Only what a screen needs to know: which records of which kind changed.
const cleanEvents = (events) =>
  Array.isArray(events) && events.length > 0 && events.length <= 50
    ? events.map((event) => {
        const kind = typeof event?.kind === 'string' && /^[a-z][a-zA-Z]{0,39}$/.test(event.kind) ? event.kind : null;
        const ids = Array.isArray(event?.ids) && event.ids.length <= 500 && event.ids.every((id) => typeof id === 'string' && IDENTIFIER.test(id)) ? event.ids : null;
        return kind && ids ? { kind, ids } : null;
      })
    : null;

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'Last-Event-ID', 'access-control-max-age': '600' };

const sendJson = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS });
  response.end(JSON.stringify(body));
};

const readBody = (request, limit = 64 * 1024) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('too large'));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });

export const startRealtimeServer = (environment = process.env) => {
  const config = settings(environment);
  // Ids keep growing across restarts, so an id from before a restart is recognised as too old and gets a resync.
  let sequence = Date.now();
  const streams = new Set();
  const history = new Map();

  const remember = (workspace, entry) => {
    const entries = history.get(workspace) ?? [];
    entries.push(entry);
    if (entries.length > config.bufferPerWorkspace) entries.shift();
    history.set(workspace, entries);
  };

  const write = (stream, text) => {
    // A client that stops reading is dropped rather than buffered for ever; it reconnects and resyncs.
    if (stream.response.writableLength > 1024 * 1024) return stream.response.destroy();
    stream.response.write(text);
  };

  const frame = (entry) => `id: ${entry.id}\nevent: change\ndata: ${JSON.stringify({ topic: entry.topic, kind: entry.kind, ids: entry.ids, at: entry.at })}\n\n`;

  const openStream = (request, response, url) => {
    const claims = verifyStreamToken(config.secret, url.searchParams.get('token'));
    if (!claims) return sendJson(response, 401, { error: 'The live updates pass is missing or has expired.' });
    const wanted = (url.searchParams.get('topics') ?? claims.topics.join(',')).split(',').filter(Boolean);
    const topics = new Set(wanted.filter((topic) => claims.topics.includes(topic) && config.topics.has(topic)));
    if (topics.size === 0) return sendJson(response, 403, { error: 'This pass does not cover these updates.' });
    if (streams.size >= config.maxStreams) return sendJson(response, 503, { error: 'Too many live connections.' });
    const ownCount = [...streams].filter((stream) => stream.workspace === claims.workspace && stream.member === claims.member).length;
    if (ownCount >= config.maxStreamsPerMember) return sendJson(response, 429, { error: 'Too many live connections for this person.' });

    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no', ...CORS });
    response.write('retry: 3000\n\n');
    const stream = { workspace: claims.workspace, member: claims.member, topics, response };
    streams.add(stream);

    const lastId = Number(request.headers['last-event-id'] ?? url.searchParams.get('lastEventId'));
    if (Number.isFinite(lastId) && lastId > 0) {
      const entries = history.get(claims.workspace) ?? [];
      const oldest = entries[0]?.id ?? sequence + 1;
      if (lastId < oldest - 1 || lastId > sequence) write(stream, `event: resync\ndata: {}\n\n`);
      else for (const entry of entries) if (entry.id > lastId && topics.has(entry.topic)) write(stream, frame(entry));
    }

    const heartbeat = setInterval(() => write(stream, ': ping\n\n'), config.heartbeatMs);
    const expiry = setTimeout(() => {
      write(stream, `event: expired\ndata: {}\n\n`);
      response.end();
    }, Math.max(0, claims.exp * 1000 - Date.now()));
    const close = () => {
      clearInterval(heartbeat);
      clearTimeout(expiry);
      streams.delete(stream);
    };
    request.on('close', close);
    response.on('error', close);
  };

  const publish = async (request, response) => {
    let body;
    try {
      body = await readBody(request);
    } catch {
      return sendJson(response, 413, { error: 'Too large.' });
    }
    if (!verifyPublish(config.secret, request.headers, body)) return sendJson(response, 401, { error: 'Bad signature.' });
    let message;
    try {
      message = JSON.parse(body);
    } catch {
      return sendJson(response, 400, { error: 'Not JSON.' });
    }
    const events = cleanEvents(message?.events);
    if (!IDENTIFIER.test(message?.workspace ?? '') || !config.topics.has(message?.topic) || !events || events.includes(null))
      return sendJson(response, 400, { error: 'Expected { workspace, topic, events: [{ kind, ids }] }.' });
    let delivered = 0;
    const at = new Date().toISOString();
    for (const event of events) {
      sequence += 1;
      const entry = { id: sequence, topic: message.topic, kind: event.kind, ids: event.ids, at };
      remember(message.workspace, entry);
      for (const stream of streams)
        if (stream.workspace === message.workspace && stream.topics.has(entry.topic)) {
          write(stream, frame(entry));
          delivered += 1;
        }
    }
    sendJson(response, 202, { delivered });
  };

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://realtime');
    if (request.method === 'OPTIONS') {
      response.writeHead(204, CORS);
      return response.end();
    }
    if (request.method === 'GET' && url.pathname === '/healthz') return sendJson(response, 200, { ok: true, streams: streams.size });
    if (request.method === 'GET' && url.pathname === '/v1/stream') return openStream(request, response, url);
    if (request.method === 'POST' && url.pathname === '/v1/publish') return void publish(request, response);
    sendJson(response, 404, { error: 'Not found.' });
  });
  // Streams stay open for an hour; Node's default request timeout would cut them after five minutes.
  server.requestTimeout = 0;
  server.headersTimeout = 10_000;

  const close = () =>
    new Promise((resolve) => {
      for (const stream of streams) stream.response.end();
      server.close(() => resolve());
    });

  return new Promise((resolve) => server.listen(config.port, config.host, () => resolve({ server, close, port: server.address().port })));
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const { close, port } = await startRealtimeServer();
  console.log(JSON.stringify({ message: 'realtime listening', port }));
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => {
      void close().then(() => process.exit(0));
    });
}
