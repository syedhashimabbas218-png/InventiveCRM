import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app/build-app.ts';
import { createJobHandlers } from '../../src/app/job-handlers.ts';
import type { TokenKey } from '../../src/crypto/token-cipher.ts';
import { MockGraphServer } from '../../src/dev/mock-graph-server.ts';
import { createSubscriptionEventBus } from '../../src/events/subscriptions.ts';
import type { BusinessEvent, EventBus } from '../../src/interfaces/event-bus.ts';
import { runDueJobs } from '../../src/jobs/worker.ts';
import { InMemoryCrm } from '../../src/stubs/in-memory-crm.ts';
import { createGraphClient, type GraphClient } from '../../src/whatsapp/graph-client.ts';
import { seedTenant, type SeededTenant } from './fixtures.ts';
import { createTestDatabase, type TestDatabase } from './test-database.ts';

export const TEST_APP_SECRET = 'test-app-secret-not-real';
export const TEST_VERIFY_TOKEN = 'test-verify-token';
export const SEND_TIMEOUT_MS = 500;

export type TestContext = {
  database: TestDatabase;
  app: FastifyInstance;
  published: BusinessEvent[];
  crm: InMemoryCrm;
  mockGraph: MockGraphServer;
  runJobs: () => Promise<number>;
  graph: GraphClient;
  tokenKey: TokenKey;
  now: Date;
  setNow: (date: Date) => void;
  advance: (milliseconds: number) => void;
  seedTenant: (name: string, options?: { route?: 'A' | 'B' | 'C' }) => Promise<SeededTenant>;
  close: () => Promise<void>;
};

export const createTestContext = async (
  options: { wrapGraph?: (graph: GraphClient) => GraphClient; allowInsecureSubscriptionUrls?: boolean; mcpAllowedOrigins?: string[] } = {},
): Promise<TestContext> => {
  const database = await createTestDatabase();
  const crm = new InMemoryCrm();
  const mockGraph = new MockGraphServer();
  const graphUrl = await mockGraph.start();
  const tokenKey: TokenKey = { id: 'test-key', key: randomBytes(32) };
  const realGraph = createGraphClient({ baseUrl: graphUrl, version: 'v26.0', timeoutMs: SEND_TIMEOUT_MS });
  const graph = options.wrapGraph ? options.wrapGraph(realGraph) : realGraph;
  const state = { now: new Date('2026-11-03T10:00:00Z') };
  const clock = () => state.now;

  const published: BusinessEvent[] = [];
  const subscriptionBus = createSubscriptionEventBus(database.app, clock);
  const eventBus: EventBus = {
    publish: async (event) => {
      published.push(event);
      await subscriptionBus.publish(event);
    },
  };

  const app = await buildApp({
    database: database.app,
    eventBus,
    graph,
    tokenKeys: [tokenKey],
    clock,
    sendTimeoutMs: SEND_TIMEOUT_MS,
    subscriptionKey: tokenKey,
    subscriptionOptions: { allowInsecureUrls: options.allowInsecureSubscriptionUrls ?? true },
    crm,
    appSecret: TEST_APP_SECRET,
    verifyToken: TEST_VERIFY_TOKEN,
    debounceSeconds: 8,
    mcpAllowedOrigins: options.mcpAllowedOrigins ?? [],
  });
  await app.ready();
  const handlers = createJobHandlers({ database: database.app, clock, eventBus, tokenKeys: [tokenKey] });

  return {
    database,
    app,
    published,
    crm,
    mockGraph,
    runJobs: () => runDueJobs({ database: database.app, clock }, handlers, { batchSize: 50, lockSeconds: 120 }),
    graph,
    tokenKey,
    get now() {
      return state.now;
    },
    setNow: (date) => {
      state.now = date;
    },
    advance: (milliseconds) => {
      state.now = new Date(state.now.getTime() + milliseconds);
    },
    seedTenant: async (name, seedOptions = {}) => {
      const tenant = await seedTenant(database.owner, name, { ...seedOptions, tokenKey });
      mockGraph.registerNumber(tenant.phoneNumberId, tenant.accessToken);
      return tenant;
    },
    close: async () => {
      await app.close();
      await mockGraph.stop();
      await database.drop();
    },
  };
};
