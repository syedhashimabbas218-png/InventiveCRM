import Fastify, { type FastifyInstance } from 'fastify';
import { registerApiRoutes } from '../api/routes.ts';
import type { SendDependencies } from '../conversations/send.ts';
import type { CrmClient } from '../interfaces/crm.ts';
import { registerWebhookRoutes } from '../messaging/webhook-routes.ts';

export type AppDependencies = SendDependencies & {
  crm: CrmClient;
  appSecret: string;
  verifyToken: string;
  debounceSeconds: number;
};

export const buildApp = async (deps: AppDependencies): Promise<FastifyInstance> => {
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
  await registerWebhookRoutes(app, deps);
  await registerApiRoutes(app, deps);
  return app;
};
