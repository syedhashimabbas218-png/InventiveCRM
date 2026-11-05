import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';

export type MockMode = 'ok' | 'reject' | 'server_error' | 'hang';

export type RecordedSend = {
  phoneNumberId: string;
  body: Record<string, unknown>;
  providerMessageId?: string;
};

// Stands in for graph.facebook.com in tests and local runs. It never contacts Meta.
export class MockGraphServer {
  readonly sends: RecordedSend[] = [];
  mode: MockMode = 'ok';
  private readonly tokens = new Map<string, string>();
  private app: FastifyInstance | undefined;
  url = '';

  registerNumber(phoneNumberId: string, accessToken: string): void {
    this.tokens.set(phoneNumberId, accessToken);
  }

  async start(): Promise<string> {
    const app = Fastify();
    app.post('/:version/:phoneNumberId/messages', async (request, reply) => {
      const { phoneNumberId } = request.params as { phoneNumberId: string };
      const expected = this.tokens.get(phoneNumberId);
      if (!expected || request.headers.authorization !== `Bearer ${expected}`) {
        return reply.code(401).send({ error: { message: 'Invalid OAuth access token', code: 190 } });
      }
      const body = request.body as Record<string, unknown>;
      if (this.mode === 'hang') {
        this.sends.push({ phoneNumberId, body });
        await new Promise((resolve) => setTimeout(resolve, 60_000).unref());
        return reply.code(504).send();
      }
      if (this.mode === 'reject') {
        return reply.code(400).send({ error: { message: 'Invalid parameter', code: 100 } });
      }
      if (this.mode === 'server_error') {
        this.sends.push({ phoneNumberId, body });
        return reply.code(500).send({ error: { message: 'Service temporarily unavailable', code: 2 } });
      }
      const providerMessageId = `wamid.mock${randomUUID().replaceAll('-', '')}`;
      this.sends.push({ phoneNumberId, body, providerMessageId });
      return { messaging_product: 'whatsapp', contacts: [{ input: body.to, wa_id: body.to }], messages: [{ id: providerMessageId }] };
    });
    this.url = await app.listen({ port: 0, host: '127.0.0.1' });
    this.app = app;
    return this.url;
  }

  async stop(): Promise<void> {
    await this.app?.close();
  }
}
