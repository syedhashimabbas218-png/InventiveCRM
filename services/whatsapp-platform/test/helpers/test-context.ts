import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app/build-app.ts';
import type { TemplatePolicy } from '../../src/conversations/send.ts';
import type { TokenKey } from '../../src/crypto/token-cipher.ts';
import { MockGraphServer } from '../../src/dev/mock-graph-server.ts';
import { InMemoryCrm } from '../../src/stubs/in-memory-crm.ts';
import { InMemoryEventBus } from '../../src/stubs/in-memory-event-bus.ts';
import { InMemoryOwnerNotifier } from '../../src/stubs/in-memory-owner-notifier.ts';
import { createGraphClient, type GraphClient } from '../../src/whatsapp/graph-client.ts';
import type { ModelAdapter } from '../../src/agent/model/types.ts';
import type { AgentDependencies } from '../../src/agent/turn.ts';
import { createAgent } from '../../src/app/create-agent.ts';
import { runDueJobs, type JobHandler } from '../../src/jobs/worker.ts';
import { InMemoryCalendar } from '../../src/stubs/in-memory-calendar.ts';
import type { BookingChangeHandler } from '../../src/tools/phase-one-tools.ts';
import { createBookingChangeHandler, createReminderHandler } from '../../src/reminders/booking-reminders.ts';
import { seedTenant, type SeededTenant } from './fixtures.ts';
import { createTestDatabase, type TestDatabase } from './test-database.ts';

export const TEST_APP_SECRET = 'test-app-secret-not-real';
export const TEST_VERIFY_TOKEN = 'test-verify-token';
export const SEND_TIMEOUT_MS = 500;

export type TestContext = {
  database: TestDatabase;
  app: FastifyInstance;
  eventBus: InMemoryEventBus;
  crm: InMemoryCrm;
  ownerNotifier: InMemoryOwnerNotifier;
  mockGraph: MockGraphServer;
  calendar: InMemoryCalendar;
  agent: AgentDependencies;
  runJobs: () => Promise<number>;
  graph: GraphClient;
  tokenKey: TokenKey;
  now: Date;
  setNow: (date: Date) => void;
  advance: (milliseconds: number) => void;
  seedTenant: (name: string, options?: { route?: 'A' | 'B' | 'C' }) => Promise<SeededTenant>;
  close: () => Promise<void>;
};

const unusedModel: ModelAdapter = {
  name: 'unused',
  complete: async () => {
    throw new Error('no model configured for this test');
  },
};

export const createTestContext = async (
  options: {
    templatePolicy?: TemplatePolicy;
    wrapGraph?: (graph: GraphClient) => GraphClient;
    model?: ModelAdapter;
    onBookingChange?: BookingChangeHandler;
    withReminders?: boolean;
  } = {},
): Promise<TestContext> => {
  const database = await createTestDatabase();
  const eventBus = new InMemoryEventBus();
  const crm = new InMemoryCrm();
  const ownerNotifier = new InMemoryOwnerNotifier();
  const mockGraph = new MockGraphServer();
  const graphUrl = await mockGraph.start();
  const tokenKey: TokenKey = { id: 'test-key', key: randomBytes(32) };
  const realGraph = createGraphClient({ baseUrl: graphUrl, version: 'v26.0', timeoutMs: SEND_TIMEOUT_MS });
  const graph = options.wrapGraph ? options.wrapGraph(realGraph) : realGraph;
  const state = { now: new Date('2026-11-03T10:00:00Z') };
  const calendar = new InMemoryCalendar();
  const clock = () => state.now;
  const sendDependencies = {
    database: database.app,
    eventBus,
    ownerNotifier,
    graph,
    tokenKeys: [tokenKey],
    clock,
    sendTimeoutMs: SEND_TIMEOUT_MS,
    templatePolicy: options.templatePolicy ?? (async () => ({ status: 422 as const, body: { reason: 'template_not_allowed' as const } })),
  };
  const wiring = {
    ...sendDependencies,
    crm,
    calendar,
    model: options.model ?? unusedModel,
    onBookingChange: options.onBookingChange ?? (options.withReminders ? createBookingChangeHandler(clock) : async () => undefined),
  };
  const { agent, turnHandler } = createAgent(wiring);
  const handlers: Record<string, JobHandler> = { 'agent.turn': turnHandler };
  if (options.withReminders) handlers['reminder.send'] = createReminderHandler(wiring);
  const app = await buildApp({
    ...sendDependencies,
    crm,
    appSecret: TEST_APP_SECRET,
    verifyToken: TEST_VERIFY_TOKEN,
    debounceSeconds: 8,
  });
  await app.ready();
  return {
    database,
    app,
    eventBus,
    crm,
    ownerNotifier,
    mockGraph,
    calendar,
    agent,
    runJobs: () => runDueJobs({ database: database.app, clock }, handlers, { batchSize: 20, lockSeconds: 120 }),
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
