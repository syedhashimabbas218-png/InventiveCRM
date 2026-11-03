import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../db/pool.ts';
import { withTenant } from '../db/pool.ts';
import { parseEnvelope, type Envelope } from '../envelope/envelope.ts';
import { claimConversation, MAX_CLAIM_TTL_SECONDS } from '../conversations/claim.ts';
import { sendMessage, type SendDependencies } from '../conversations/send.ts';
import { customerServiceWindow } from '../whatsapp/window.ts';
import { authenticateBearer, authorizeEnvelope } from './authenticate.ts';

type ApiDependencies = SendDependencies & { database: Database };

const authenticatedEnvelope = async (
  deps: ApiDependencies,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Envelope<Record<string, unknown>> | undefined> => {
  const credential = await authenticateBearer(deps.database, request.headers.authorization);
  if (!credential) {
    await reply.code(401).send({ error: 'unauthenticated' });
    return undefined;
  }
  const parsed = parseEnvelope(request.body);
  if (!parsed.ok) {
    await reply.code(400).send({ error: 'invalid_envelope', details: parsed.errors });
    return undefined;
  }
  const denied = authorizeEnvelope(credential, parsed.envelope);
  if (denied) {
    await reply.code(403).send({ error: denied });
    return undefined;
  }
  return parsed.envelope;
};

export const registerApiRoutes = async (app: FastifyInstance, deps: ApiDependencies): Promise<void> => {
  app.post('/v1/conversations/:id/claim', async (request, reply) => {
    const envelope = await authenticatedEnvelope(deps, request, reply);
    if (!envelope) return reply;
    const { id } = request.params as { id: string };
    const payload = envelope.payload;
    const ttl = payload.ttl_seconds;
    if (
      payload.claimant !== 'ai' ||
      !(typeof payload.latest_message_id === 'string' || payload.latest_message_id === null) ||
      typeof ttl !== 'number' ||
      !Number.isInteger(ttl) ||
      ttl < 1 ||
      ttl > MAX_CLAIM_TTL_SECONDS ||
      envelope.actor.type === 'user'
    ) {
      return reply.code(422).send({ error: 'invalid_claim_request' });
    }
    const result = await claimConversation(deps, envelope.tenant_id, {
      conversationId: id,
      claimant: 'ai',
      latestMessageId: payload.latest_message_id,
      ttlSeconds: ttl,
    });
    if (result.claimed) return reply.code(200).send({ claimed: true, claim_id: result.claimId });
    if (result.reason === 'not_found') return reply.code(404).send({ claimed: false, reason: 'not_found' });
    return reply.code(409).send({
      claimed: false,
      reason: result.reason,
      ...(result.retryAfterSeconds ? { retry_after_seconds: result.retryAfterSeconds } : {}),
    });
  });

  app.post('/v1/messages/send', async (request, reply) => {
    const envelope = await authenticatedEnvelope(deps, request, reply);
    if (!envelope) return reply;
    const result = await sendMessage(deps, envelope);
    return reply.code(result.status).send(result.body);
  });

  app.post('/v1/conversations/:id/state', async (request, reply) => {
    const envelope = await authenticatedEnvelope(deps, request, reply);
    if (!envelope) return reply;
    const { id } = request.params as { id: string };
    const now = deps.clock();
    const row = await withTenant(deps.database, envelope.tenant_id, async (client) =>
      (
        await client.query(
          `SELECT id, state, ai_paused_until, last_customer_message_at, last_human_reply_at,
                  (claim_id IS NOT NULL AND claim_expires_at > $3) AS claimed
           FROM conversations WHERE tenant_id = $1 AND id = $2`,
          [envelope.tenant_id, id, now],
        )
      ).rows[0],
    );
    if (!row) return reply.code(404).send({ reason: 'not_found' });
    const window = customerServiceWindow(row.last_customer_message_at, now);
    return {
      id: row.id,
      state: row.state,
      ai_paused_until: row.ai_paused_until,
      last_human_reply_at: row.last_human_reply_at,
      claimed: row.claimed,
      window: { open: window.open, closes_at: window.closesAt },
    };
  });
};
