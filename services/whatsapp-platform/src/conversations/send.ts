import { decryptToken, type TokenKey } from '../crypto/token-cipher.ts';
import { withTenant, type Database, type TenantClient } from '../db/pool.ts';
import type { Actor, Envelope } from '../envelope/envelope.ts';
import type { EventBus } from '../interfaces/event-bus.ts';
import type { OwnerNotifier } from '../interfaces/owner-notifier.ts';
import type { Clock } from '../shared/clock.ts';
import { newId } from '../shared/ids.ts';
import { GraphSendError, type GraphClient, type OutboundMessage } from '../whatsapp/graph-client.ts';
import { customerServiceWindow } from '../whatsapp/window.ts';
import { isAiSendingEnabled, latestInboundMessage } from './ai-guards.ts';
import { applyHumanTakeover, loadTenantSettings, lockConversation, type ConversationRow } from './conversation-store.ts';

export type SendPayload = {
  conversation_id: string;
  claim_id?: string;
  type: 'text' | 'buttons' | 'template';
  body?: string;
  buttons?: { id: string; title: string }[];
  template?: { name: string; language_code: string; body_parameters?: string[]; quick_reply_payloads?: string[] };
};

export type SendRefusalReason =
  | 'human_active'
  | 'paused'
  | 'closed'
  | 'claim_invalid'
  | 'newer_message'
  | 'outside_window'
  | 'in_progress'
  | 'outcome_unknown'
  | 'idempotency_key_reused'
  | 'template_not_allowed'
  | 'opted_out'
  | 'template_cap_reached';

export type SendResult =
  | { status: 200; body: { message_id: string; replayed?: true } }
  | { status: 404; body: { reason: 'not_found' } }
  | { status: 409 | 423 | 429; body: { reason: SendRefusalReason } }
  | { status: 422; body: { reason: 'invalid_payload' | 'outside_window' | 'template_not_allowed'; errors?: string[] } }
  | { status: 502; body: { reason: 'provider_rejected' | 'outcome_unknown' } };

// Extra checks for template sends (library, opt-out, weekly cap). Returns a refusal or undefined.
export type TemplatePolicy = (
  client: TenantClient,
  context: { conversation: ConversationRow; template: NonNullable<SendPayload['template']>; actor: Actor; now: Date },
) => Promise<SendResult | undefined>;

export type SendDependencies = {
  database: Database;
  clock: Clock;
  graph: GraphClient;
  tokenKeys: readonly TokenKey[];
  ownerNotifier: OwnerNotifier;
  eventBus: EventBus;
  templatePolicy: TemplatePolicy;
  sendTimeoutMs: number;
};

const MAX_TEXT_LENGTH = 4096;
const MAX_INTERACTIVE_BODY_LENGTH = 1024;
const MAX_BUTTON_TITLE_LENGTH = 20;
const MAX_BUTTON_ID_LENGTH = 256;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const parseSendPayload = (input: unknown): { ok: true; payload: SendPayload } | { ok: false; errors: string[] } => {
  if (!isObject(input)) return { ok: false, errors: ['payload must be an object'] };
  const errors: string[] = [];
  const allowed = new Set(['conversation_id', 'claim_id', 'type', 'body', 'buttons', 'template']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) errors.push(`unknown field: ${key}`);
  if (typeof input.conversation_id !== 'string' || !input.conversation_id) errors.push('conversation_id is required');
  if (input.claim_id !== undefined && typeof input.claim_id !== 'string') errors.push('claim_id must be a string');

  if (input.type === 'text') {
    if (typeof input.body !== 'string' || !input.body.trim() || input.body.length > MAX_TEXT_LENGTH) {
      errors.push(`body must be 1-${MAX_TEXT_LENGTH} characters`);
    }
  } else if (input.type === 'buttons') {
    if (typeof input.body !== 'string' || !input.body.trim() || input.body.length > MAX_INTERACTIVE_BODY_LENGTH) {
      errors.push(`body must be 1-${MAX_INTERACTIVE_BODY_LENGTH} characters`);
    }
    const buttons = input.buttons;
    if (!Array.isArray(buttons) || buttons.length < 1 || buttons.length > 3) {
      errors.push('buttons must have 1-3 entries');
    } else {
      const titles = new Set<string>();
      for (const button of buttons) {
        if (
          !isObject(button) ||
          typeof button.id !== 'string' ||
          !button.id ||
          button.id.length > MAX_BUTTON_ID_LENGTH ||
          typeof button.title !== 'string' ||
          !button.title ||
          button.title.length > MAX_BUTTON_TITLE_LENGTH
        ) {
          errors.push('each button needs an id (<=256) and a title (<=20)');
        } else if (titles.has(button.title)) {
          errors.push('button titles must be unique');
        } else {
          titles.add(button.title);
        }
      }
    }
  } else if (input.type === 'template') {
    const template = input.template;
    if (
      !isObject(template) ||
      typeof template.name !== 'string' ||
      typeof template.language_code !== 'string' ||
      (template.body_parameters !== undefined &&
        (!Array.isArray(template.body_parameters) || !template.body_parameters.every((value) => typeof value === 'string'))) ||
      (template.quick_reply_payloads !== undefined &&
        (!Array.isArray(template.quick_reply_payloads) ||
          !template.quick_reply_payloads.every((value) => typeof value === 'string')))
    ) {
      errors.push('template needs name, language_code and string parameters');
    }
  } else {
    errors.push('type must be text, buttons or template');
  }

  return errors.length ? { ok: false, errors } : { ok: true, payload: input as unknown as SendPayload };
};

const toOutbound = (payload: SendPayload): OutboundMessage => {
  switch (payload.type) {
    case 'text':
      return { kind: 'text', text: payload.body ?? '' };
    case 'buttons':
      return { kind: 'buttons', text: payload.body ?? '', buttons: payload.buttons ?? [] };
    case 'template':
      return {
        kind: 'template',
        template: {
          name: payload.template?.name ?? '',
          languageCode: payload.template?.language_code ?? '',
          bodyParameters: (payload.template?.body_parameters ?? []).map((text) => ({ type: 'text', text })),
          quickReplyPayloads: payload.template?.quick_reply_payloads,
        },
      };
  }
};

const SENDER_TYPE: Record<Actor['type'], 'human' | 'ai' | 'system'> = { user: 'human', agent: 'ai', system: 'system' };

const findByIdempotencyKey = async (client: TenantClient, key: string) =>
  (
    await client.query<{ id: string; conversation_id: string }>(
      'SELECT id, conversation_id FROM messages WHERE tenant_id = $1 AND idempotency_key = $2',
      [client.tenantId, key],
    )
  ).rows[0];

const checkSendAllowed = async (
  deps: SendDependencies,
  client: TenantClient,
  conversation: ConversationRow,
  actor: Actor,
  payload: SendPayload,
  now: Date,
): Promise<SendResult | undefined> => {
  if (conversation.state === 'CLOSED') return { status: 423, body: { reason: 'closed' } };

  if (actor.type !== 'user') {
    if (conversation.state === 'HUMAN_ACTIVE') return { status: 423, body: { reason: 'human_active' } };
    if (!(await isAiSendingEnabled(client))) return { status: 423, body: { reason: 'paused' } };
    if (conversation.state === 'AWAITING_APPROVAL') return { status: 423, body: { reason: 'paused' } };
    if (conversation.ai_paused_until && conversation.ai_paused_until > now) {
      return { status: 423, body: { reason: 'paused' } };
    }
    if (
      !payload.claim_id ||
      conversation.claim_id !== payload.claim_id ||
      !conversation.claim_expires_at ||
      conversation.claim_expires_at <= now
    ) {
      return { status: 409, body: { reason: 'claim_invalid' } };
    }
    const latest = await latestInboundMessage(client, conversation.id);
    if ((latest?.id ?? null) !== conversation.claim_latest_message_id) {
      return { status: 409, body: { reason: 'newer_message' } };
    }
  }

  if (payload.type === 'template' && payload.template) {
    return deps.templatePolicy(client, { conversation, template: payload.template, actor, now });
  }
  if (!customerServiceWindow(conversation.last_customer_message_at, now).open) {
    return { status: 422, body: { reason: 'outside_window' } };
  }
  return undefined;
};

type AttemptOutcome =
  | { kind: 'proceed' }
  | { kind: 'replay'; messageId: string; conversationId: string }
  | { kind: 'refuse'; result: SendResult };

// Committed on its own before the provider call so it survives a crash of this process.
const recordAttempt = async (
  deps: SendDependencies,
  tenantId: string,
  key: string,
  conversationId: string,
  now: Date,
): Promise<AttemptOutcome> =>
  withTenant(deps.database, tenantId, async (client) => {
    const replay = await findByIdempotencyKey(client, key);
    if (replay) return { kind: 'replay', messageId: replay.id, conversationId: replay.conversation_id };

    const result = await client.query<{ status: string; inserted: boolean; updated_at: Date }>(
      `INSERT INTO send_attempts (tenant_id, idempotency_key, conversation_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'in_flight', $4, $4)
       ON CONFLICT (tenant_id, idempotency_key) DO UPDATE
       SET status = 'in_flight', updated_at = $4
       WHERE send_attempts.status = 'rejected' AND send_attempts.conversation_id = $3
       RETURNING status, true AS inserted, updated_at`,
      [tenantId, key, conversationId, now],
    );
    if (result.rows[0]) return { kind: 'proceed' };

    const existing = (
      await client.query<{ status: string; conversation_id: string; updated_at: Date }>(
        'SELECT status, conversation_id, updated_at FROM send_attempts WHERE tenant_id = $1 AND idempotency_key = $2',
        [tenantId, key],
      )
    ).rows[0];
    if (!existing || existing.conversation_id !== conversationId) {
      return { kind: 'refuse', result: { status: 409, body: { reason: 'idempotency_key_reused' } } };
    }
    const stillRunning = now.getTime() - existing.updated_at.getTime() < deps.sendTimeoutMs * 2;
    return {
      kind: 'refuse',
      result: { status: 409, body: { reason: stillRunning ? 'in_progress' : 'outcome_unknown' } },
    };
  });

const finishAttempt = async (
  deps: SendDependencies,
  tenantId: string,
  key: string,
  status: 'sent' | 'rejected',
  messageId: string | null,
) => {
  await withTenant(deps.database, tenantId, (client) =>
    client.query(
      `UPDATE send_attempts SET status = $3, message_id = $4, updated_at = $5
       WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, key, status, messageId, deps.clock()],
    ),
  );
};

export const sendMessage = async (deps: SendDependencies, envelope: Envelope<unknown>): Promise<SendResult> => {
  const parsed = parseSendPayload(envelope.payload);
  if (!parsed.ok) return { status: 422, body: { reason: 'invalid_payload', errors: parsed.errors } };
  const payload = parsed.payload;
  const tenantId = envelope.tenant_id;
  const key = envelope.idempotency_key;
  const actor = envelope.actor;

  if (actor.type !== 'user' && !payload.claim_id) return { status: 409, body: { reason: 'claim_invalid' } };

  const attempt = await recordAttempt(deps, tenantId, key, payload.conversation_id, deps.clock());
  if (attempt.kind === 'replay') {
    return attempt.conversationId === payload.conversation_id
      ? { status: 200, body: { message_id: attempt.messageId, replayed: true } }
      : { status: 409, body: { reason: 'idempotency_key_reused' } };
  }
  if (attempt.kind === 'refuse') return attempt.result;

  let outcome: { result: SendResult; attempt: 'sent' | 'rejected' | 'unknown'; messageId?: string; conversationId?: string };
  try {
    outcome = await withTenant(deps.database, tenantId, async (client) => {
      const now = deps.clock();
      // Held across the provider call: an echo or inbox reply waits for this send rather than racing it.
      const conversation = await lockConversation(client, payload.conversation_id);
      if (!conversation) return { result: { status: 404, body: { reason: 'not_found' } }, attempt: 'rejected' } as const;

      const refusal = await checkSendAllowed(deps, client, conversation, actor, payload, now);
      if (refusal) return { result: refusal, attempt: 'rejected' } as const;

      const account = (
        await client.query<{ phone_number_id: string; access_token_ciphertext: Buffer | null; access_token_key_id: string | null }>(
          'SELECT phone_number_id, access_token_ciphertext, access_token_key_id FROM whatsapp_accounts WHERE tenant_id = $1 AND id = $2',
          [tenantId, conversation.whatsapp_account_id],
        )
      ).rows[0];
      if (!account?.access_token_ciphertext || !account.access_token_key_id) {
        return { result: { status: 502, body: { reason: 'provider_rejected' } }, attempt: 'rejected' } as const;
      }
      const accessToken = decryptToken(deps.tokenKeys, tenantId, {
        keyId: account.access_token_key_id,
        ciphertext: account.access_token_ciphertext,
      });

      let providerMessageId: string;
      try {
        ({ providerMessageId } = await deps.graph.sendMessage({
          phoneNumberId: account.phone_number_id,
          accessToken,
          to: conversation.customer_identity,
          message: toOutbound(payload),
        }));
      } catch (error) {
        const definite = error instanceof GraphSendError && error.definite;
        return {
          result: { status: 502, body: { reason: definite ? 'provider_rejected' : 'outcome_unknown' } },
          attempt: definite ? 'rejected' : 'unknown',
          conversationId: conversation.id,
        } as const;
      }

      const messageId = newId('msg');
      await client.query(
        `INSERT INTO messages (id, tenant_id, conversation_id, channel, provider_message_id, direction, sender_type,
                               sender_identity, message_type, body, template, content, status, idempotency_key,
                               claim_id, received_at)
         VALUES ($1, $2, $3, 'whatsapp', $4, 'outbound', $5, $6, $7, $8, $9, $10, 'sent', $11, $12, $13)`,
        [
          messageId,
          tenantId,
          conversation.id,
          providerMessageId,
          SENDER_TYPE[actor.type],
          actor.id,
          payload.type,
          payload.body ?? null,
          payload.template ?? null,
          payload.buttons ? { buttons: payload.buttons } : {},
          key,
          payload.claim_id ?? null,
          now,
        ],
      );
      if (actor.type === 'user') {
        const settings = await loadTenantSettings(client);
        await applyHumanTakeover(client, conversation.id, now, settings.human_pause_hours);
      } else {
        await client.query(
          'UPDATE conversations SET last_message_at = greatest(last_message_at, $3), updated_at = $3 WHERE tenant_id = $1 AND id = $2',
          [tenantId, conversation.id, now],
        );
      }
      return {
        result: { status: 200, body: { message_id: messageId } },
        attempt: 'sent',
        messageId,
        conversationId: conversation.id,
      } as const;
    });
  } catch (error) {
    // Unexpected failure: the attempt stays in_flight, so a retry is refused rather than risking a double send.
    await deps.ownerNotifier.alert({
      tenantId,
      conversationId: payload.conversation_id,
      kind: 'send_outcome_unknown',
      message: `Send failed unexpectedly: ${(error as Error).message}`,
    });
    return { status: 502, body: { reason: 'outcome_unknown' } };
  }

  if (outcome.attempt === 'sent' || outcome.attempt === 'rejected') {
    await finishAttempt(deps, tenantId, key, outcome.attempt, outcome.messageId ?? null);
  } else {
    await deps.ownerNotifier.alert({
      tenantId,
      conversationId: outcome.conversationId,
      kind: 'send_outcome_unknown',
      message: 'A message may or may not have been delivered; it will not be retried automatically.',
    });
  }

  if (outcome.result.status === 200 && outcome.messageId) {
    await deps.eventBus.publish({
      tenant_id: tenantId,
      actor,
      correlation_id: envelope.correlation_id,
      idempotency_key: `message.sent:${outcome.messageId}`,
      occurred_at: deps.clock().toISOString(),
      payload: { type: 'message.sent', data: { conversation_id: outcome.conversationId, message_id: outcome.messageId } },
    });
  }
  return outcome.result;
};
