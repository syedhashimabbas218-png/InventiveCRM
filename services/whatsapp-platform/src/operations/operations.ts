import { writeAudit } from '../audit/audit-log.ts';
import type { TokenKey } from '../crypto/token-cipher.ts';
import { withTenant } from '../db/pool.ts';
import type { ActorType, Envelope } from '../envelope/envelope.ts';
import { claimConversation, MAX_CLAIM_TTL_SECONDS, releaseClaim } from '../conversations/claim.ts';
import { loadTenantSettings, pauseAi } from '../conversations/conversation-store.ts';
import { sendMessage, type SendDependencies } from '../conversations/send.ts';
import {
  createSubscription,
  disableSubscription,
  isBusinessEventType,
  listSubscriptions,
  validateSubscriptionUrl,
  type SubscriptionOptions,
} from '../events/subscriptions.ts';
import { newId } from '../shared/ids.ts';
import { listTemplates, upsertTemplate, validateTemplateDefinition, type TemplateDefinition, type TemplateStatus } from '../templates/templates.ts';
import { customerServiceWindow } from '../whatsapp/window.ts';

export type OperationDependencies = SendDependencies & {
  subscriptionKey: TokenKey;
  subscriptionOptions: SubscriptionOptions;
};

// Who is calling, taken from the authenticated credential. Never from the request body.
export type Caller = { tenantId: string; credentialId: string; actorTypes: ActorType[] };

export type OperationResult = { status: number; body: Record<string, unknown> };

export const HANDOFF_REASONS = ['customer_asked', 'complaint', 'refund', 'price_dispute', 'emergency', 'unsure', 'other'] as const;

// Which envelope actor types may perform each write. Reads are open to any credential of the tenant.
const WRITE_ACTORS = {
  claim: ['agent', 'system'],
  release: ['agent', 'system'],
  send: ['user', 'agent', 'system'],
  handoff: ['user', 'agent', 'system'],
  manage_templates: ['system'],
  manage_subscriptions: ['system'],
} as const satisfies Record<string, readonly ActorType[]>;

export type WriteOperation = keyof typeof WRITE_ACTORS;

const unprocessable = (error: string): OperationResult => ({ status: 422, body: { reason: 'invalid_payload', errors: [error] } });

export const authorizeWrite = (caller: Caller, envelope: Envelope<unknown>, operation: WriteOperation): OperationResult | undefined => {
  if (envelope.tenant_id !== caller.tenantId) return { status: 403, body: { error: 'tenant_mismatch' } };
  if (!caller.actorTypes.includes(envelope.actor.type)) return { status: 403, body: { error: 'actor_not_allowed' } };
  if (!(WRITE_ACTORS[operation] as readonly ActorType[]).includes(envelope.actor.type)) {
    return { status: 403, body: { error: 'operation_not_allowed_for_actor' } };
  }
  return undefined;
};

const audited = async (
  deps: OperationDependencies,
  envelope: Envelope<unknown>,
  action: string,
  target: string | undefined,
  run: () => Promise<OperationResult>,
): Promise<OperationResult> => {
  const result = await run();
  await writeAudit(deps.database, {
    tenantId: envelope.tenant_id,
    actor: envelope.actor,
    correlationId: envelope.correlation_id,
    action,
    target,
    decision: result.status < 300 ? 'allowed' : result.status >= 500 ? 'error' : 'denied',
    details: { status: result.status, reason: result.body.reason ?? result.body.error ?? null, idempotency_key: envelope.idempotency_key },
    occurredAt: deps.clock(),
  });
  return result;
};

// Awaiting reply: the newest message is from the customer, and an automated reply is not blocked by a human or a pause.
const AWAITING_REPLY_SQL = `
  c.state <> 'CLOSED' AND c.state <> 'AWAITING_APPROVAL'
  AND (c.ai_paused_until IS NULL OR c.ai_paused_until <= $2)
  AND (SELECT m.direction FROM messages m WHERE m.tenant_id = c.tenant_id AND m.conversation_id = c.id ORDER BY m.seq DESC LIMIT 1) = 'inbound'`;

export const listConversations = async (
  deps: OperationDependencies,
  caller: Caller,
  query: { awaitingReply?: boolean; limit?: number },
): Promise<OperationResult> => {
  const now = deps.clock();
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
  const rows = await withTenant(deps.database, caller.tenantId, async (client) =>
    (
      await client.query(
        `SELECT c.id, c.customer_identity AS customer, c.state, c.last_message_at, c.last_customer_message_at,
                c.ai_paused_until, (${AWAITING_REPLY_SQL}) AS awaiting_reply
         FROM conversations c
         WHERE c.tenant_id = $1 ${query.awaitingReply ? `AND ${AWAITING_REPLY_SQL}` : ''}
         ORDER BY c.last_message_at DESC NULLS LAST LIMIT $3`,
        [caller.tenantId, now, limit],
      )
    ).rows,
  );
  return {
    status: 200,
    body: {
      conversations: rows.map((row) => ({
        id: row.id,
        customer: row.customer,
        state: row.state,
        awaiting_reply: row.awaiting_reply,
        ai_paused_until: row.ai_paused_until,
        last_message_at: row.last_message_at,
        window_open: customerServiceWindow(row.last_customer_message_at, now).open,
      })),
    },
  };
};

export const getConversation = async (deps: OperationDependencies, caller: Caller, conversationId: string): Promise<OperationResult> => {
  const now = deps.clock();
  const row = await withTenant(deps.database, caller.tenantId, async (client) =>
    (
      await client.query(
        `SELECT c.id, c.customer_identity AS customer, c.crm_person_id, c.state, c.ai_paused_until, c.last_customer_message_at,
                c.last_human_reply_at, (c.claim_id IS NOT NULL AND c.claim_expires_at > $3) AS claimed,
                (SELECT m.id FROM messages m WHERE m.tenant_id = c.tenant_id AND m.conversation_id = c.id AND m.direction = 'inbound'
                 ORDER BY m.seq DESC LIMIT 1) AS latest_message_id,
                (${AWAITING_REPLY_SQL.replaceAll('$2', '$3')}) AS awaiting_reply
         FROM conversations c WHERE c.tenant_id = $1 AND c.id = $2`,
        [caller.tenantId, conversationId, now],
      )
    ).rows[0],
  );
  if (!row) return { status: 404, body: { reason: 'not_found' } };
  const window = customerServiceWindow(row.last_customer_message_at, now);
  return {
    status: 200,
    body: {
      id: row.id,
      customer: row.customer,
      crm_person_id: row.crm_person_id,
      state: row.state,
      awaiting_reply: row.awaiting_reply,
      latest_message_id: row.latest_message_id,
      claimed: row.claimed,
      ai_paused_until: row.ai_paused_until,
      last_human_reply_at: row.last_human_reply_at,
      window: { open: window.open, closes_at: window.closesAt },
    },
  };
};

export const getMessages = async (
  deps: OperationDependencies,
  caller: Caller,
  conversationId: string,
  limitInput?: number,
): Promise<OperationResult> => {
  const limit = Math.min(Math.max(limitInput ?? 30, 1), 100);
  const result = await withTenant(deps.database, caller.tenantId, async (client) => {
    const exists = await client.query('SELECT 1 FROM conversations WHERE tenant_id = $1 AND id = $2', [caller.tenantId, conversationId]);
    if (!exists.rowCount) return undefined;
    return (
      await client.query(
        `SELECT * FROM (
           SELECT id, direction, sender_type, message_type AS type, body, content, template, status, received_at, seq
           FROM messages WHERE tenant_id = $1 AND conversation_id = $2 ORDER BY seq DESC LIMIT $3
         ) recent ORDER BY seq`,
        [caller.tenantId, conversationId, limit],
      )
    ).rows.map(({ seq: _seq, ...row }) => row);
  });
  if (!result) return { status: 404, body: { reason: 'not_found' } };
  return { status: 200, body: { conversation_id: conversationId, messages: result } };
};

export const claim = async (
  deps: OperationDependencies,
  caller: Caller,
  envelope: Envelope<Record<string, unknown>>,
  conversationId: string,
): Promise<OperationResult> => {
  const denied = authorizeWrite(caller, envelope, 'claim');
  if (denied) return denied;
  const payload = envelope.payload;
  const ttl = payload.ttl_seconds ?? 120;
  if (payload.claimant !== 'ai') return unprocessable('claimant must be "ai"');
  if (!(typeof payload.latest_message_id === 'string' || payload.latest_message_id === null)) {
    return unprocessable('latest_message_id must be a message id or null');
  }
  if (typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl < 1 || ttl > MAX_CLAIM_TTL_SECONDS) {
    return unprocessable(`ttl_seconds must be 1-${MAX_CLAIM_TTL_SECONDS}`);
  }
  return audited(deps, envelope, 'conversation.claim', conversationId, async () => {
    const result = await claimConversation(deps, caller.tenantId, {
      conversationId,
      claimant: 'ai',
      latestMessageId: payload.latest_message_id as string | null,
      ttlSeconds: ttl,
    });
    if (result.claimed) return { status: 200, body: { claimed: true, claim_id: result.claimId, expires_at: result.expiresAt } };
    if (result.reason === 'not_found') return { status: 404, body: { claimed: false, reason: 'not_found' } };
    return {
      status: 409,
      body: { claimed: false, reason: result.reason, ...(result.retryAfterSeconds ? { retry_after_seconds: result.retryAfterSeconds } : {}) },
    };
  });
};

export const release = async (
  deps: OperationDependencies,
  caller: Caller,
  envelope: Envelope<Record<string, unknown>>,
  conversationId: string,
): Promise<OperationResult> => {
  const denied = authorizeWrite(caller, envelope, 'release');
  if (denied) return denied;
  const claimId = envelope.payload.claim_id;
  if (typeof claimId !== 'string' || !claimId) return unprocessable('claim_id is required');
  return audited(deps, envelope, 'conversation.release', conversationId, async () => {
    await releaseClaim(deps, caller.tenantId, conversationId, claimId);
    return { status: 200, body: { released: true } };
  });
};

export const send = async (deps: OperationDependencies, caller: Caller, envelope: Envelope<Record<string, unknown>>): Promise<OperationResult> => {
  const denied = authorizeWrite(caller, envelope, 'send');
  if (denied) return denied;
  const target = typeof envelope.payload.conversation_id === 'string' ? envelope.payload.conversation_id : undefined;
  return audited(deps, envelope, 'message.send', target, async () => {
    const result = await sendMessage(deps, envelope);
    return { status: result.status, body: result.body };
  });
};

export const handoff = async (
  deps: OperationDependencies,
  caller: Caller,
  envelope: Envelope<Record<string, unknown>>,
  conversationId: string,
): Promise<OperationResult> => {
  const denied = authorizeWrite(caller, envelope, 'handoff');
  if (denied) return denied;
  const { reason, summary } = envelope.payload;
  if (typeof reason !== 'string' || !(HANDOFF_REASONS as readonly string[]).includes(reason)) {
    return unprocessable(`reason must be one of ${HANDOFF_REASONS.join(', ')}`);
  }
  if (summary !== undefined && (typeof summary !== 'string' || summary.length > 500)) return unprocessable('summary must be at most 500 characters');
  return audited(deps, envelope, 'conversation.handoff', conversationId, async () => {
    const now = deps.clock();
    const pausedUntil = await withTenant(deps.database, caller.tenantId, async (client) => {
      const exists = await client.query('SELECT 1 FROM conversations WHERE tenant_id = $1 AND id = $2', [caller.tenantId, conversationId]);
      if (!exists.rowCount) return undefined;
      const settings = await loadTenantSettings(client);
      const until = new Date(now.getTime() + settings.human_pause_hours * 3600_000);
      await pauseAi(client, conversationId, now, until);
      return until;
    });
    if (!pausedUntil) return { status: 404, body: { reason: 'not_found' } };
    await deps.eventBus.publish({
      tenant_id: caller.tenantId,
      actor: envelope.actor,
      correlation_id: envelope.correlation_id,
      idempotency_key: `conversation.handoff_requested:${envelope.idempotency_key}`,
      occurred_at: now.toISOString(),
      payload: { type: 'conversation.handoff_requested', data: { conversation_id: conversationId, reason, summary: summary ?? null } },
    });
    return { status: 200, body: { handed_off: true, ai_paused_until: pausedUntil } };
  });
};

export const getTemplates = async (deps: OperationDependencies, caller: Caller): Promise<OperationResult> => ({
  status: 200,
  body: { templates: await withTenant(deps.database, caller.tenantId, (client) => listTemplates(client)) },
});

const TEMPLATE_STATUSES: readonly TemplateStatus[] = ['pending', 'approved', 'rejected', 'paused', 'disabled'];

export const putTemplate = async (deps: OperationDependencies, caller: Caller, envelope: Envelope<Record<string, unknown>>): Promise<OperationResult> => {
  const denied = authorizeWrite(caller, envelope, 'manage_templates');
  if (denied) return denied;
  const payload = envelope.payload;
  const stringArray = (value: unknown) => (Array.isArray(value) && value.every((item) => typeof item === 'string') ? (value as string[]) : undefined);
  const definition: TemplateDefinition = {
    name: String(payload.name ?? ''),
    language: String(payload.language ?? ''),
    category: payload.category as TemplateDefinition['category'],
    body: String(payload.body ?? ''),
    parameters: stringArray(payload.parameters ?? []) ?? ['<invalid>'],
    quick_replies: stringArray(payload.quick_replies ?? []) ?? ['<invalid>'],
  };
  const status = (payload.status ?? 'pending') as TemplateStatus;
  const errors = validateTemplateDefinition(definition);
  if (!TEMPLATE_STATUSES.includes(status)) errors.push(`status must be one of ${TEMPLATE_STATUSES.join(', ')}`);
  if (errors.length) return { status: 422, body: { reason: 'invalid_template', errors } };
  return audited(deps, envelope, 'template.upsert', `${definition.name}:${definition.language}`, async () => {
    await withTenant(deps.database, caller.tenantId, (client) => upsertTemplate(client, definition, status, deps.clock()));
    return { status: 200, body: { saved: true, name: definition.name, language: definition.language, status } };
  });
};

export const postSubscription = async (
  deps: OperationDependencies,
  caller: Caller,
  envelope: Envelope<Record<string, unknown>>,
): Promise<OperationResult> => {
  const denied = authorizeWrite(caller, envelope, 'manage_subscriptions');
  if (denied) return denied;
  const { url, event_types: eventTypes } = envelope.payload;
  if (typeof url !== 'string') return unprocessable('url is required');
  const urlError = validateSubscriptionUrl(url, deps.subscriptionOptions);
  if (urlError) return unprocessable(urlError);
  if (!Array.isArray(eventTypes) || eventTypes.length === 0 || !eventTypes.every(isBusinessEventType)) {
    return unprocessable('event_types must list known event types');
  }
  return audited(deps, envelope, 'subscription.create', url, async () => {
    const created = await withTenant(deps.database, caller.tenantId, (client) =>
      createSubscription(client, { url, eventTypes: [...new Set(eventTypes)] }, deps.subscriptionKey, deps.clock()),
    );
    return { status: 201, body: { id: created.id, secret: created.secret, note: 'The secret is shown once. Use it to verify X-Signature-256.' } };
  });
};

export const getSubscriptions = async (deps: OperationDependencies, caller: Caller): Promise<OperationResult> => ({
  status: 200,
  body: { subscriptions: await withTenant(deps.database, caller.tenantId, (client) => listSubscriptions(client)) },
});

export const removeSubscription = async (
  deps: OperationDependencies,
  caller: Caller,
  envelope: Envelope<Record<string, unknown>>,
  subscriptionId: string,
): Promise<OperationResult> => {
  const denied = authorizeWrite(caller, envelope, 'manage_subscriptions');
  if (denied) return denied;
  return audited(deps, envelope, 'subscription.disable', subscriptionId, async () => {
    const disabled = await withTenant(deps.database, caller.tenantId, (client) => disableSubscription(client, subscriptionId));
    return disabled ? { status: 200, body: { disabled: true } } : { status: 404, body: { reason: 'not_found' } };
  });
};

// For callers (MCP) that do not send an envelope: built server-side from the credential.
export const serverEnvelope = (
  caller: Caller,
  actorType: ActorType,
  payload: Record<string, unknown>,
  idempotencyKey: string,
  now: Date,
): Envelope<Record<string, unknown>> => ({
  tenant_id: caller.tenantId,
  actor: { type: actorType, id: caller.credentialId },
  correlation_id: newId('cor'),
  idempotency_key: idempotencyKey,
  occurred_at: now.toISOString(),
  payload,
});
