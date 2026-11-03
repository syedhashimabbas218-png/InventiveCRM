export type ModelToolCall = { id: string; name: string; arguments: unknown };

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ModelToolCall[] }
  | { role: 'tool'; toolCallId: string; toolName: string; content: string };

export type ModelTool = { name: string; description: string; parameters: Record<string, unknown> };

export type ModelRequest = {
  messages: ChatMessage[];
  tools: ModelTool[];
  maxOutputTokens: number;
};

export type ModelResponse = {
  content: string;
  toolCalls: ModelToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
};

export type ModelAdapter = {
  name: string;
  complete: (request: ModelRequest) => Promise<ModelResponse>;
};

export class ModelError extends Error {}
