import { buildApp } from './app/build-app.ts';
import { createJobHandlers } from './app/job-handlers.ts';
import { loadConfig } from './config.ts';
import { loadTokenKeyFromEnvironment } from './crypto/token-cipher.ts';
import { createDatabase } from './db/pool.ts';
import { createSubscriptionEventBus } from './events/subscriptions.ts';
import { runDueJobs } from './jobs/worker.ts';
import { systemClock } from './shared/clock.ts';
import { InMemoryCrm } from './stubs/in-memory-crm.ts';
import { createGraphClient } from './whatsapp/graph-client.ts';

const WORKER_INTERVAL_MS = 1000;

const config = loadConfig(process.env);
const database = createDatabase(config.databaseUrl);
const tokenKey = loadTokenKeyFromEnvironment(process.env);
const eventBus = createSubscriptionEventBus(database, systemClock);

// The CRM belongs to another part of the platform; this stub stands in until it is connected.
const crm = new InMemoryCrm();

const app = await buildApp({
  database,
  clock: systemClock,
  graph: createGraphClient({ baseUrl: config.graphApiBaseUrl, version: config.graphApiVersion, timeoutMs: 10_000 }),
  tokenKeys: [tokenKey],
  eventBus,
  sendTimeoutMs: 10_000,
  subscriptionKey: tokenKey,
  subscriptionOptions: { allowInsecureUrls: config.allowInsecureSubscriptionUrls },
  crm,
  appSecret: config.metaAppSecret,
  verifyToken: config.metaWebhookVerifyToken,
  debounceSeconds: config.debounceSeconds,
  mcpAllowedOrigins: config.mcpAllowedOrigins,
});

const handlers = createJobHandlers({ database, clock: systemClock, eventBus, tokenKeys: [tokenKey] });
let working = false;
setInterval(() => {
  if (working) return;
  working = true;
  runDueJobs({ database, clock: systemClock }, handlers, { batchSize: 20, lockSeconds: 120 })
    .catch((error: Error) => app.log.error(error, 'job run failed'))
    .finally(() => {
      working = false;
    });
}, WORKER_INTERVAL_MS);

await app.listen({ port: config.port, host: '0.0.0.0' });
