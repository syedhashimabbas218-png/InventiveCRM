import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ingestWebhook, type IngestDependencies } from './ingest.ts';

const WEBHOOK_BODY_LIMIT_BYTES = 5 * 1024 * 1024;

const safeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export const registerWebhookRoutes = async (
  app: FastifyInstance,
  deps: IngestDependencies & { verifyToken: string },
): Promise<void> => {
  await app.register(async (scope) => {
    // Signature verification needs the exact bytes Meta sent, so this scope never parses JSON itself.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: WEBHOOK_BODY_LIMIT_BYTES }, (_request, body, done) =>
      done(null, body),
    );

    scope.get('/webhooks/whatsapp', async (request, reply) => {
      const query = request.query as Record<string, string | undefined>;
      if (
        query['hub.mode'] === 'subscribe' &&
        typeof query['hub.verify_token'] === 'string' &&
        safeEqual(query['hub.verify_token'], deps.verifyToken) &&
        typeof query['hub.challenge'] === 'string'
      ) {
        return reply.type('text/plain').send(query['hub.challenge']);
      }
      return reply.code(403).send({ error: 'verification_failed' });
    });

    scope.post('/webhooks/whatsapp', async (request, reply) => {
      const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const header = request.headers['x-hub-signature-256'];
      const result = await ingestWebhook(deps, rawBody, typeof header === 'string' ? header : undefined);
      return reply.code(result.status).send(result.body);
    });
  });
};
