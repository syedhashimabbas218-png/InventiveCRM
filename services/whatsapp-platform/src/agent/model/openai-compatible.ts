import { ModelError, type ChatMessage, type ModelAdapter, type ModelResponse } from './types.ts';

type CompletionResponse = {
  model?: string;
  choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

const toOpenAiMessage = (message: ChatMessage): Record<string, unknown> => {
  switch (message.role) {
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
              })),
            }
          : {}),
      };
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    default:
      return { role: message.role, content: message.content };
  }
};

// The fallback provider: any endpoint speaking the OpenAI chat-completions format.
export const createOpenAiCompatibleModel = (options: { baseUrl: string; apiKey: string; model: string; timeoutMs: number }): ModelAdapter => ({
  name: `openai-compatible:${options.model}`,
  complete: async (request): Promise<ModelResponse> => {
    let response: Response;
    try {
      response = await fetch(`${options.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          messages: request.messages.map(toOpenAiMessage),
          tools: request.tools.map((tool) => ({ type: 'function', function: tool })),
          max_tokens: request.maxOutputTokens,
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      throw new ModelError(`fallback request failed: ${(error as Error).name}`);
    }
    if (!response.ok) throw new ModelError(`fallback returned ${response.status}`);
    const body = (await response.json()) as CompletionResponse;
    const message = body.choices?.[0]?.message;
    return {
      content: message?.content ?? '',
      toolCalls: (message?.tool_calls ?? []).map((call, index) => {
        let parsedArguments: unknown;
        try {
          parsedArguments = JSON.parse(call.function?.arguments ?? '{}');
        } catch {
          parsedArguments = undefined;
        }
        return { id: call.id ?? `call_${index}`, name: call.function?.name ?? '', arguments: parsedArguments };
      }),
      usage: { inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0 },
      model: body.model ?? options.model,
    };
  },
});
