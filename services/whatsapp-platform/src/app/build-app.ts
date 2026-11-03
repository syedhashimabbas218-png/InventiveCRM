import Fastify, { type FastifyInstance } from 'fastify';
import { registerApiRoutes } from '../api/routes.ts';
import type { CrmClient } from '../interfaces/crm.ts';
import { registerMcpRoutes } from '../mcp/mcp-routes.ts';
import { registerWebhookRoutes } from '../messaging/webhook-routes.ts';
import type { OperationDependencies } from '../operations/operations.ts';

export type AppDependencies = OperationDependencies & {
  crm: CrmClient;
  appSecret: string;
  verifyToken: string;
  debounceSeconds: number;
  mcpAllowedOrigins: readonly string[];
};

export const buildApp = async (deps: AppDependencies): Promise<FastifyInstance> => {
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
  await registerWebhookRoutes(app, deps);
  await registerApiRoutes(app, deps);
  await registerMcpRoutes(app, deps, { allowedOrigins: deps.mcpAllowedOrigins });
  return app;
};
