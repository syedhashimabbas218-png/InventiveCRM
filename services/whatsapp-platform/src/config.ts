export type Config = {
  port: number;
  databaseUrl: string;
  metaAppSecret: string;
  metaWebhookVerifyToken: string;
  graphApiBaseUrl: string;
  graphApiVersion: string;
  debounceSeconds: number;
};

const required = (environment: NodeJS.ProcessEnv, name: string): string => {
  const value = environment[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
};

export const loadConfig = (environment: NodeJS.ProcessEnv): Config => ({
  port: Number(environment.PORT ?? 3100),
  databaseUrl: required(environment, 'DATABASE_URL'),
  metaAppSecret: required(environment, 'META_APP_SECRET'),
  metaWebhookVerifyToken: required(environment, 'META_WEBHOOK_VERIFY_TOKEN'),
  graphApiBaseUrl: required(environment, 'GRAPH_API_BASE_URL'),
  graphApiVersion: environment.GRAPH_API_VERSION ?? 'v26.0',
  debounceSeconds: Number(environment.DEBOUNCE_SECONDS ?? 8),
});
