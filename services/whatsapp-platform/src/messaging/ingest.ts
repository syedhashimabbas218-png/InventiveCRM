import { createHash } from 'node:crypto';
import { withTenant, type Database, type TenantClient } from '../db/pool.ts';
import {
  applyHumanTakeover,
  findOrCreateOpenConversation,
  loadTenantSettings,
  recordCustomerMessage,
} from '../conversations/conversation-store.ts';
import type { CrmClient } from '../interfaces/crm.ts';
import type { BusinessEvent, BusinessEventType, EventBus } from '../interfaces/event-bus.ts';
import { enqueueJob } from '../jobs/queue.ts';
import type { Clock } from '../shared/clock.ts';
import { newId } from '../shared/ids.ts';
import { normaliseWebhook } from './normalise.ts';
import {
  contentAsText,
  type EchoEvent,
  type InboundMessageEvent,
  type MessageContent,
  type NormalisedEvent,
  type StatusEvent,
} from './normalised-event.ts';
import { graceMinutesAt, type OpeningHours } from './opening-hours.ts';
import { isValidWebhookSignature } from './signature.ts';

// Meta retries failed deliveries for up to 36 hours; anything older is a replay, not a retry.
export const MAX_EVENT_AGE_MS = 48 * 60 * 60 * 1000;
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

const OPT_OUT_KEYWORDS = new Set(['stop', 'unsubscribe', 'opt out', 'optout']);
const OPT_IN_KEYWORDS = new Set(['start', 'subscribe']);

export type IngestDependencies = {
  database: Database;
  eventBus: EventBus;
  crm: CrmClient;
  clock: Clock;
  appSecret: string;
  debounceSeconds: number;
};

export type EventOutcome =
  | { kind: 'ignored'; reason: string }
  | { kind: 'duplicate'; providerMessageId: string }
  | { kind: 'stored'; tenantId: string; conversationId: string; messageId: string; event: NormalisedEvent['kind'] }
  | { kind: 'status_updated'; tenantId: string; providerMessageId: string; updated: boolean };

export type IngestResult = {
  status: 200 | 400 | 401;
  body: { outcomes?: EventOutcome[]; duplicate_body?: true; error?: string };
};

type ResolvedAccount = {
  tenant_id: string;
  whatsapp_account_id: string;
  waba_id: string;
  connection_route: 'A' | 'B' | 'C';
};

class DuplicateEvent extends Error {}

const messageType = (content: MessageContent): string =>
  content.kind === 'media' ? content.mediaType : content.kind === 'unsupported' ? content.providerType : content.kind;

const keyword = (content: MessageContent): string | undefined =>
  content.kind === 'text' ? content.text.trim().toLowerCase().replace(/[.!]+$/, '') : undefined;

const eventTime = (event: InboundMessageEvent | EchoEvent | StatusEvent): Date =>
  event.kind === 'status' ? event.at : event.sentAt;

const buildEvent = (
  tenantId: string,
  type: BusinessEventType,
  data: Record<string, unknown>,
  idempotencyKey: string,
  now: Date,
): BusinessEvent => ({
  tenant_id: tenantId,
  actor: { type: 'system', id: 'messaging-service' },
  correlation_id: newId('cor'),
  idempotency_key: idempotencyKey,
  occurred_at: now.toISOString(),
  payload: { type, data },
});

const insertMessage = async (
  client: TenantClient,
  conversationId: string,
  event: InboundMessageEvent | EchoEvent,
  now: Date,
): Promise<string> => {
  const isEcho = event.kind === 'echo';
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO messages (id, tenant_id, conversation_id, channel, provider_message_id, direction, sender_type,
                           sender_identity, message_type, body, content, provider_sent_at,
                           reply_to_provider_message_id, status, received_at)
     VALUES ($1, $2, $3, 'whatsapp', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (tenant_id, channel, provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      newId('msg'),
      client.tenantId,
      conversationId,
      event.providerMessageId,
      isEcho ? 'echo' : 'inbound',
      isEcho ? 'human' : 'customer',
      event.from,
      messageType(event.content),
      contentAsText(event.content) || null,
      event.content,
      event.sentAt,
      event.kind === 'inbound_message' ? (event.replyToProviderMessageId ?? null) : null,
      isEcho ? 'sent' : 'received',
      now,
    ],
  );
  const messageId = inserted.rows[0]?.id;
  if (!messageId) throw new DuplicateEvent();

  if (event.content.kind === 'media') {
    await client.query(
      `INSERT INTO attachments (id, tenant_id, message_id, type, provider_media_id, mime_type, sha256, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        newId('att'),
        client.tenantId,
        messageId,
        event.content.mediaType,
        event.content.providerMediaId,
        event.content.mimeType,
        event.content.sha256 ?? null,
        now,
      ],
    );
  }
  return messageId;
};

const processInbound = async (
  deps: IngestDependencies,
  account: ResolvedAccount,
  event: InboundMessageEvent,
  now: Date,
  published: BusinessEvent[],
): Promise<EventOutcome> => {
  const tenantId = account.tenant_id;
  const stored = await withTenant(deps.database, tenantId, async (client) => {
    const conversation = await findOrCreateOpenConversation(client, account.whatsapp_account_id, event.from, now);
    const messageId = await insertMessage(client, conversation.id, event, now);
    await recordCustomerMessage(client, conversation.id, event.sentAt, now);

    const word = keyword(event.content);
    const optOut = word !== undefined && OPT_OUT_KEYWORDS.has(word);
    const optIn = word !== undefined && OPT_IN_KEYWORDS.has(word);
    await client.query(
      `INSERT INTO customer_contacts (tenant_id, customer_identity, profile_name, opted_out_at, updated_at)
       VALUES ($1, $2, $3, CASE WHEN $4 THEN $5::timestamptz END, $5)
       ON CONFLICT (tenant_id, customer_identity) DO UPDATE
       SET profile_name = coalesce(excluded.profile_name, customer_contacts.profile_name),
           opted_out_at = CASE WHEN $4 THEN $5::timestamptz WHEN $6 THEN NULL ELSE customer_contacts.opted_out_at END,
           updated_at = $5`,
      [tenantId, event.from, event.profileName ?? null, optOut, now, optIn],
    );

    if (!optOut) {
      const settings = await loadTenantSettings(client);
      const graceMs =
        graceMinutesAt(
          { ...settings, opening_hours: settings.opening_hours as OpeningHours },
          event.sentAt,
        ) * 60_000;
      const runAt = new Date(Math.max(event.sentAt.getTime() + graceMs, now.getTime() + deps.debounceSeconds * 1000));
      await enqueueJob(client, {
        kind: 'agent.turn',
        payload: { conversation_id: conversation.id, message_id: messageId },
        idempotencyKey: `agent.turn:${messageId}`,
        runAt,
      });
    }

    return { conversationId: conversation.id, messageId, crmPersonId: conversation.crm_person_id, optOut };
  });

  published.push(
    buildEvent(
      tenantId,
      'message.received',
      { conversation_id: stored.conversationId, message_id: stored.messageId },
      `message.received:${stored.messageId}`,
      now,
    ),
  );
  if (stored.optOut) {
    published.push(
      buildEvent(tenantId, 'customer.opted_out', { conversation_id: stored.conversationId }, `opt_out:${stored.messageId}`, now),
    );
  }

  if (!stored.crmPersonId) {
    // Best effort: the agent turn retries CRM matching if this fails.
    try {
      const person = await deps.crm.findOrCreatePersonByPhone(tenantId, event.from, event.profileName);
      await withTenant(deps.database, tenantId, (client) =>
        client.query(
          'UPDATE conversations SET crm_person_id = $3 WHERE tenant_id = $1 AND id = $2 AND crm_person_id IS NULL',
          [tenantId, stored.conversationId, person.id],
        ),
      );
    } catch {
      // left unset; the turn pipeline resolves it
    }
  }

  return { kind: 'stored', tenantId, conversationId: stored.conversationId, messageId: stored.messageId, event: 'inbound_message' };
};

const processEcho = async (
  deps: IngestDependencies,
  account: ResolvedAccount,
  event: EchoEvent,
  now: Date,
  published: BusinessEvent[],
): Promise<EventOutcome> => {
  if (account.connection_route !== 'A') {
    return { kind: 'ignored', reason: 'echo_on_non_coexistence_number' };
  }
  const tenantId = account.tenant_id;
  const stored = await withTenant(deps.database, tenantId, async (client) => {
    const conversation = await findOrCreateOpenConversation(client, account.whatsapp_account_id, event.to, now);
    const messageId = await insertMessage(client, conversation.id, event, now);
    const settings = await loadTenantSettings(client);
    await applyHumanTakeover(client, conversation.id, now, settings.human_pause_hours);
    return { conversationId: conversation.id, messageId };
  });
  published.push(
    buildEvent(
      tenantId,
      'conversation.human_takeover',
      { conversation_id: stored.conversationId, source: 'echo' },
      `takeover:${stored.messageId}`,
      now,
    ),
  );
  return { kind: 'stored', tenantId, conversationId: stored.conversationId, messageId: stored.messageId, event: 'echo' };
};

const processStatus = async (deps: IngestDependencies, account: ResolvedAccount, event: StatusEvent): Promise<EventOutcome> => {
  const result = await withTenant(deps.database, account.tenant_id, (client) =>
    client.query(
      `UPDATE messages
       SET status = $3, provider_error = coalesce($4, provider_error)
       WHERE tenant_id = $1 AND channel = 'whatsapp' AND provider_message_id = $2 AND direction = 'outbound'
         AND CASE
               WHEN $3 = 'failed' THEN status IN ('pending', 'sent')
               ELSE status <> 'failed' AND
                    (CASE status WHEN 'pending' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 9 END)
                    < (CASE $3 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END)
             END`,
      [account.tenant_id, event.providerMessageId, event.status, event.errors ? JSON.stringify(event.errors) : null],
    ),
  );
  return {
    kind: 'status_updated',
    tenantId: account.tenant_id,
    providerMessageId: event.providerMessageId,
    updated: (result.rowCount ?? 0) > 0,
  };
};

const processEvent = async (
  deps: IngestDependencies,
  event: NormalisedEvent,
  now: Date,
  published: BusinessEvent[],
): Promise<EventOutcome> => {
  if (event.kind === 'ignored') return event;

  const age = now.getTime() - eventTime(event).getTime();
  if (age > MAX_EVENT_AGE_MS) return { kind: 'ignored', reason: 'stale_event' };
  if (age < -MAX_FUTURE_SKEW_MS) return { kind: 'ignored', reason: 'event_from_the_future' };

  const resolved = await deps.database.query<ResolvedAccount>('SELECT * FROM resolve_tenant_by_phone_number_id($1)', [
    event.phoneNumberId,
  ]);
  const account = resolved.rows[0];
  if (!account) return { kind: 'ignored', reason: 'unknown_phone_number_id' };
  if (account.waba_id !== event.businessAccountId) return { kind: 'ignored', reason: 'business_account_mismatch' };

  try {
    switch (event.kind) {
      case 'inbound_message':
        return await processInbound(deps, account, event, now, published);
      case 'echo':
        return await processEcho(deps, account, event, now, published);
      case 'status':
        return await processStatus(deps, account, event);
    }
  } catch (error) {
    if (error instanceof DuplicateEvent) {
      return { kind: 'duplicate', providerMessageId: event.providerMessageId };
    }
    throw error;
  }
};

// Throws on internal failure so the route answers 500 and Meta retries; every step is idempotent.
export const ingestWebhook = async (
  deps: IngestDependencies,
  rawBody: Buffer,
  signatureHeader: string | undefined,
): Promise<IngestResult> => {
  if (!isValidWebhookSignature(deps.appSecret, rawBody, signatureHeader)) {
    return { status: 401, body: { error: 'invalid_signature' } };
  }

  const bodyDigest = createHash('sha256').update(rawBody).digest('hex');
  const seen = await deps.database.query('SELECT 1 FROM webhook_receipts WHERE body_sha256 = $1', [bodyDigest]);
  if (seen.rowCount) {
    return { status: 200, body: { duplicate_body: true } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { status: 400, body: { error: 'invalid_json' } };
  }

  const now = deps.clock();
  const published: BusinessEvent[] = [];
  const outcomes: EventOutcome[] = [];
  for (const event of normaliseWebhook(parsed)) {
    outcomes.push(await processEvent(deps, event, now, published));
  }

  await deps.database.query(
    'INSERT INTO webhook_receipts (body_sha256, received_at) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [bodyDigest, now],
  );

  for (const event of published) {
    await deps.eventBus.publish(event);
  }

  return { status: 200, body: { outcomes } };
};
