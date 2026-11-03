import { ModelError, type ChatMessage, type ModelAdapter, type ModelResponse } from './types.ts';

type OllamaToolCall = { function?: { name?: string; arguments?: unknown } };
type OllamaChatResponse = {
  model?: string;
  message?: { content?: string; tool_calls?: OllamaToolCall[] };
  prompt_eval_count?: number;
  eval_count?: number;
};

const toOllamaMessage = (message: ChatMessage): Record<string, unknown> => {
  switch (message.role) {
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content,
        ...(message.toolCalls?.length
          ? { tool_calls: message.toolCalls.map((call) => ({ function: { name: call.name, arguments: call.arguments } })) }
          : {}),
      };
    case 'tool':
      return { role: 'tool', tool_name: message.toolName, content: message.content };
    default:
      return { role: message.role, content: message.content };
  }
};

// Ollama Cloud's native API (https://ollama.com/api/chat), bearer-authenticated with OLLAMA_API_KEY.
export const createOllamaCloudModel = (options: { baseUrl: string; apiKey: string; model: string; timeoutMs: number }): ModelAdapter => ({
  name: `ollama:${options.model}`,
  complete: async (request): Promise<ModelResponse> => {
    let response: Response;
    try {
      response = await fetch(`${options.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          stream: false,
          messages: request.messages.map(toOllamaMessage),
          tools: request.tools.map((tool) => ({ type: 'function', function: tool })),
          options: { num_predict: request.maxOutputTokens, temperature: 0.2 },
        }),
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      throw new ModelError(`ollama request failed: ${(error as Error).name}`);
    }
    if (!response.ok) throw new ModelError(`ollama returned ${response.status}`);
    const body = (await response.json()) as OllamaChatResponse;
    return {
      content: body.message?.content ?? '',
      toolCalls: (body.message?.tool_calls ?? []).map((call, index) => {
        const rawArguments = call.function?.arguments;
        let parsedArguments: unknown = rawArguments;
        if (typeof rawArguments === 'string') {
          try {
            parsedArguments = JSON.parse(rawArguments);
          } catch {
            parsedArguments = undefined;
          }
        }
        return { id: `call_${index}`, name: call.function?.name ?? '', arguments: parsedArguments };
      }),
      usage: { inputTokens: body.prompt_eval_count ?? 0, outputTokens: body.eval_count ?? 0 },
      model: body.model ?? options.model,
    };
  },
});
