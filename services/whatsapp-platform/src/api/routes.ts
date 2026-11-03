import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { parseEnvelope, type Envelope } from '../envelope/envelope.ts';
import {
  claim,
  getConversation,
  getMessages,
  getSubscriptions,
  getTemplates,
  handoff,
  listConversations,
  postSubscription,
  putTemplate,
  release,
  removeSubscription,
  send,
  type Caller,
  type OperationDependencies,
  type OperationResult,
} from '../operations/operations.ts';
import { authenticateBearer } from './authenticate.ts';

type Handler = (caller: Caller, request: FastifyRequest) => Promise<OperationResult>;
type WriteHandler = (caller: Caller, envelope: Envelope<Record<string, unknown>>, request: FastifyRequest) => Promise<OperationResult>;

const parseLimit = (value: unknown): number | undefined => (typeof value === 'string' && /^\d{1,3}$/.test(value) ? Number(value) : undefined);

export const registerApiRoutes = async (app: FastifyInstance, deps: OperationDependencies): Promise<void> => {
  const authenticated = async (request: FastifyRequest, reply: FastifyReply): Promise<Caller | undefined> => {
    const caller = await authenticateBearer(deps.database, request.headers.authorization);
    if (!caller) await reply.code(401).send({ error: 'unauthenticated' });
    return caller;
  };

  const read = (handler: Handler) => async (request: FastifyRequest, reply: FastifyReply) => {
    const caller = await authenticated(request, reply);
    if (!caller) return reply;
    const result = await handler(caller, request);
    return reply.code(result.status).send(result.body);
  };

  // Every write carries the 5.2 envelope.
  const write = (handler: WriteHandler) => async (request: FastifyRequest, reply: FastifyReply) => {
    const caller = await authenticated(request, reply);
    if (!caller) return reply;
    const parsed = parseEnvelope<Record<string, unknown>>(request.body);
    if (!parsed.ok) return reply.code(400).send({ error: 'invalid_envelope', details: parsed.errors });
    const result = await handler(caller, parsed.envelope, request);
    return reply.code(result.status).send(result.body);
  };

  const id = (request: FastifyRequest) => (request.params as { id: string }).id;

  app.get(
    '/v1/conversations',
    read((caller, request) => {
      const query = request.query as Record<string, string | undefined>;
      return listConversations(deps, caller, { awaitingReply: query.awaiting_reply === 'true', limit: parseLimit(query.limit) });
    }),
  );
  app.get('/v1/conversations/:id', read((caller, request) => getConversation(deps, caller, id(request))));
  app.get(
    '/v1/conversations/:id/messages',
    read((caller, request) => getMessages(deps, caller, id(request), parseLimit((request.query as Record<string, string>).limit))),
  );
  app.post('/v1/conversations/:id/claim', write((caller, envelope, request) => claim(deps, caller, envelope, id(request))));
  app.post('/v1/conversations/:id/release', write((caller, envelope, request) => release(deps, caller, envelope, id(request))));
  app.post('/v1/conversations/:id/handoff', write((caller, envelope, request) => handoff(deps, caller, envelope, id(request))));
  app.post('/v1/messages/send', write((caller, envelope) => send(deps, caller, envelope)));

  app.get('/v1/templates', read((caller) => getTemplates(deps, caller)));
  app.post('/v1/templates', write((caller, envelope) => putTemplate(deps, caller, envelope)));

  app.get('/v1/subscriptions', read((caller) => getSubscriptions(deps, caller)));
  app.post('/v1/subscriptions', write((caller, envelope) => postSubscription(deps, caller, envelope)));
  app.post('/v1/subscriptions/:id/disable', write((caller, envelope, request) => removeSubscription(deps, caller, envelope, id(request))));
};
