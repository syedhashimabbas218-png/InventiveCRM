import type { ModelAdapter, ModelRequest, ModelResponse } from './types.ts';

export type ScriptedStep = (request: ModelRequest, callIndex: number) => Partial<ModelResponse> | Promise<Partial<ModelResponse>>;

// Deterministic stand-in for tests and evals: each call returns the next scripted step.
export class ScriptedModel implements ModelAdapter {
  readonly name = 'scripted';
  readonly requests: ModelRequest[] = [];

  constructor(private readonly step: ScriptedStep) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const result = await this.step(request, this.requests.length - 1);
    return {
      content: result.content ?? '',
      toolCalls: result.toolCalls ?? [],
      usage: result.usage ?? { inputTokens: 100, outputTokens: 20 },
      model: result.model ?? this.name,
    };
  }
}
