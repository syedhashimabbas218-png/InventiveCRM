import { selectModel } from './agent/model/select-model.ts';
import { buildApp } from './app/build-app.ts';
import { createAgent } from './app/create-agent.ts';
import { loadConfig } from './config.ts';
import { loadTokenKeyFromEnvironment } from './crypto/token-cipher.ts';
import { createDatabase } from './db/pool.ts';
import { runDueJobs } from './jobs/worker.ts';
import { systemClock } from './shared/clock.ts';
import { InMemoryCalendar } from './stubs/in-memory-calendar.ts';
import { InMemoryCrm } from './stubs/in-memory-crm.ts';
import { InMemoryEventBus } from './stubs/in-memory-event-bus.ts';
import { InMemoryOwnerNotifier } from './stubs/in-memory-owner-notifier.ts';
import { createGraphClient } from './whatsapp/graph-client.ts';

const WORKER_INTERVAL_MS = 1000;

const config = loadConfig(process.env);
const database = createDatabase(config.databaseUrl);

// CRM, calendar, event bus and owner alerts are owned by other parts of the platform; these stubs stand in.
const crm = new InMemoryCrm();
const calendar = new InMemoryCalendar();
const eventBus = new InMemoryEventBus();
const ownerNotifier = new InMemoryOwnerNotifier();

const sendDependencies = {
  database,
  clock: systemClock,
  graph: createGraphClient({ baseUrl: config.graphApiBaseUrl, version: config.graphApiVersion, timeoutMs: 10_000 }),
  tokenKeys: [loadTokenKeyFromEnvironment(process.env)],
  ownerNotifier,
  eventBus,
  templatePolicy: async () => ({ status: 422 as const, body: { reason: 'template_not_allowed' as const } }),
  sendTimeoutMs: 10_000,
};

const { turnHandler } = createAgent({
  ...sendDependencies,
  crm,
  calendar,
  model: selectModel(process.env),
  onBookingChange: async () => undefined,
});

const app = await buildApp({
  ...sendDependencies,
  crm,
  appSecret: config.metaAppSecret,
  verifyToken: config.metaWebhookVerifyToken,
  debounceSeconds: config.debounceSeconds,
});

let working = false;
setInterval(() => {
  if (working) return;
  working = true;
  runDueJobs({ database, clock: systemClock }, { 'agent.turn': turnHandler }, { batchSize: 10, lockSeconds: 120 })
    .catch((error: Error) => app.log.error(error, 'job run failed'))
    .finally(() => {
      working = false;
    });
}, WORKER_INTERVAL_MS);

await app.listen({ port: config.port, host: '0.0.0.0' });
