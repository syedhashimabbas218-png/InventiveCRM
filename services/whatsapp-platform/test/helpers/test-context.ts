import Fastify, { type FastifyInstance } from 'fastify';
import { registerWebhookRoutes } from '../../src/messaging/webhook-routes.ts';
import { InMemoryCrm } from '../../src/stubs/in-memory-crm.ts';
import { InMemoryEventBus } from '../../src/stubs/in-memory-event-bus.ts';
import { createTestDatabase, type TestDatabase } from './test-database.ts';

export const TEST_APP_SECRET = 'test-app-secret-not-real';
export const TEST_VERIFY_TOKEN = 'test-verify-token';

export type TestContext = {
  database: TestDatabase;
  app: FastifyInstance;
  eventBus: InMemoryEventBus;
  crm: InMemoryCrm;
  now: Date;
  setNow: (date: Date) => void;
  close: () => Promise<void>;
};

export const createTestContext = async (): Promise<TestContext> => {
  const database = await createTestDatabase();
  const eventBus = new InMemoryEventBus();
  const crm = new InMemoryCrm();
  const state = { now: new Date('2026-11-03T10:00:00Z') };
  const app = Fastify();
  await registerWebhookRoutes(app, {
    database: database.app,
    eventBus,
    crm,
    clock: () => state.now,
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
    get now() {
      return state.now;
    },
    setNow: (date) => {
      state.now = date;
    },
    close: async () => {
      await app.close();
      await database.drop();
    },
  };
};
