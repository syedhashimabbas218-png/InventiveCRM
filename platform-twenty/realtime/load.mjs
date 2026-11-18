// Load and restart check for the realtime service: many open screens across many workspaces, a burst of notices,
// then a restart in the middle, after which every screen must reconnect and be told to resync.
// Usage: node load.mjs [screens] [workspaces] [notices]   (starts its own service on a free port; nothing else is touched)
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

import { createStreamToken, publishSignature } from './server.mjs';

const [screens = 1000, workspaces = 50, notices = 200] = process.argv.slice(2).map(Number);
const secret = randomBytes(32).toString('hex');
const freePort = () =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const serverPath = fileURLToPath(new URL('./server.mjs', import.meta.url));

let hub;
const startHub = async () => {
  hub = spawn(process.execPath, [serverPath], { env: { ...process.env, REALTIME_SECRET: secret, REALTIME_HOST: '127.0.0.1', REALTIME_PORT: String(port), REALTIME_MAX_STREAMS: String(screens + 100) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await once(hub.stdout, 'data');
};
const memoryMb = async () => {
  const { readFile } = await import('node:fs/promises');
  const status = await readFile(`/proc/${hub.pid}/status`, 'utf8');
  return Math.round(Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0) / 1024);
};

const workspaceId = (index) => `w-${index}`;
const received = new Map();
const resyncs = new Set();
let reconnected = 0;

// One simulated screen: keeps its stream open, records notices, and reconnects with its last id when cut off.
const screen = async (index) => {
  const workspace = workspaceId(index % workspaces);
  const token = createStreamToken(secret, { workspace, member: `m-${index}`, topics: ['whatsapp'], exp: Math.floor(Date.now() / 1000) + 3600 });
  let lastId = '';
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${base}/v1/stream?token=${encodeURIComponent(token)}&topics=whatsapp${lastId ? `&lastEventId=${lastId}` : ''}`);
      if (attempt > 0 && response.ok) reconnected += 1;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffered.indexOf('\n\n')) >= 0) {
          const block = buffered.slice(0, end);
          buffered = buffered.slice(end + 2);
          const id = /^id: (.+)$/m.exec(block)?.[1];
          if (id) lastId = id;
          if (block.includes('event: resync')) resyncs.add(index);
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (block.includes('event: change') && data) {
            const notice = JSON.parse(data);
            const sentAt = Number(notice.ids[0]);
            const delays = received.get(index) ?? [];
            delays.push(Date.now() - sentAt);
            received.set(index, delays);
          }
        }
      }
    } catch {
      // The service went away; try again shortly, as the app screens do.
    }
    await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 300));
  }
};

const publish = async (workspace) => {
  const body = JSON.stringify({ workspace, topic: 'whatsapp', events: [{ kind: 'message', ids: [String(Date.now())] }] });
  const timestamp = Math.floor(Date.now() / 1000);
  const response = await fetch(`${base}/v1/publish`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-realtime-timestamp': String(timestamp), 'x-realtime-signature': publishSignature(secret, timestamp, body) }, body });
  return (await response.json()).delivered ?? 0;
};

const percentile = (values, share) => values.sort((left, right) => left - right)[Math.min(values.length - 1, Math.ceil(share * values.length) - 1)] ?? 0;

await startHub();
const idleMemory = await memoryMb();
for (let index = 0; index < screens; index += 1) void screen(index);
for (let wait = 0; wait < 100; wait += 1) {
  const health = await (await fetch(`${base}/healthz`)).json();
  if (health.streams >= screens) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const openStreams = (await (await fetch(`${base}/healthz`)).json()).streams;
const loadedMemory = await memoryMb();

let delivered = 0;
const started = Date.now();
for (let index = 0; index < notices; index += 1) delivered += await publish(workspaceId(index % workspaces));
const publishSeconds = (Date.now() - started) / 1000;
await new Promise((resolve) => setTimeout(resolve, 1000));
const expectedPerScreen = (index) => Math.floor(notices / workspaces) + (index % workspaces < notices % workspaces ? 1 : 0);
const complete = [...Array(screens).keys()].filter((index) => (received.get(index)?.length ?? 0) === expectedPerScreen(index)).length;
const delays = [...received.values()].flat();

hub.kill('SIGTERM');
await once(hub, 'exit');
const reconnectStarted = Date.now();
await startHub();
for (let wait = 0; wait < 200; wait += 1) {
  if (resyncs.size >= screens) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const reconnectSeconds = (Date.now() - reconnectStarted) / 1000;
const afterRestart = (await (await fetch(`${base}/healthz`)).json()).streams;

console.log(JSON.stringify({
  screens,
  workspaces,
  openStreams,
  memoryMb: { idle: idleMemory, withStreams: loadedMemory },
  notices: { published: notices, deliveries: delivered, publishPerSecond: Math.round(notices / publishSeconds), screensWithEveryNotice: complete },
  deliveryMs: { p50: percentile(delays, 0.5), p95: percentile(delays, 0.95), p99: percentile(delays, 0.99), max: Math.max(...delays) },
  restart: { reconnectedStreams: afterRestart, screensToldToResync: resyncs.size, secondsUntilAllResynced: reconnectSeconds },
}, null, 2));
hub.kill('SIGTERM');
process.exit(0);
