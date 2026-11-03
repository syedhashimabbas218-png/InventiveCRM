import { createOllamaCloudModel } from './ollama-cloud.ts';
import { createOpenAiCompatibleModel } from './openai-compatible.ts';
import type { ModelAdapter } from './types.ts';

export const withFallback = (primary: ModelAdapter, fallback: ModelAdapter): ModelAdapter => ({
  name: `${primary.name}|${fallback.name}`,
  complete: async (request) => {
    try {
      return await primary.complete(request);
    } catch {
      return fallback.complete(request);
    }
  },
});

const required = (environment: NodeJS.ProcessEnv, name: string): string => {
  const value = environment[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
};

// MODEL_PROVIDER picks the primary; MODEL_FALLBACK_ENABLED=true switches on the fallback provider.
export const selectModel = (environment: NodeJS.ProcessEnv): ModelAdapter => {
  const timeoutMs = Number(environment.MODEL_TIMEOUT_MS ?? 30_000);
  const fallback = () =>
    createOpenAiCompatibleModel({
      baseUrl: required(environment, 'FALLBACK_MODEL_BASE_URL'),
      apiKey: required(environment, 'FALLBACK_MODEL_API_KEY'),
      model: required(environment, 'FALLBACK_MODEL'),
      timeoutMs,
    });
  const primary =
    environment.MODEL_PROVIDER === 'fallback'
      ? fallback()
      : createOllamaCloudModel({
          baseUrl: environment.OLLAMA_BASE_URL ?? 'https://ollama.com',
          apiKey: required(environment, 'OLLAMA_API_KEY'),
          model: required(environment, 'OLLAMA_MODEL'),
          timeoutMs,
        });
  return environment.MODEL_FALLBACK_ENABLED === 'true' && environment.MODEL_PROVIDER !== 'fallback'
    ? withFallback(primary, fallback())
    : primary;
};
