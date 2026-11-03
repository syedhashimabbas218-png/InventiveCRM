import type { TenantClient } from '../db/pool.ts';
import { newId } from '../shared/ids.ts';

export type ConversationState = 'AI_ACTIVE' | 'HUMAN_ACTIVE' | 'AWAITING_APPROVAL' | 'CLOSED';

export type ConversationRow = {
  id: string;
  tenant_id: string;
  whatsapp_account_id: string;
  customer_identity: string;
  crm_person_id: string | null;
  state: ConversationState;
  last_message_at: Date | null;
  last_customer_message_at: Date | null;
  last_human_reply_at: Date | null;
  ai_paused_until: Date | null;
  claim_id: string | null;
  claim_holder: string | null;
  claim_latest_message_id: string | null;
  claim_expires_at: Date | null;
};

export const lockConversation = async (
  client: TenantClient,
  conversationId: string,
): Promise<ConversationRow | undefined> => {
  const result = await client.query<ConversationRow>(
    'SELECT * FROM conversations WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
    [client.tenantId, conversationId],
  );
  return result.rows[0];
};

export const findOrCreateOpenConversation = async (
  client: TenantClient,
  whatsappAccountId: string,
  customerIdentity: string,
  now: Date,
): Promise<ConversationRow> => {
  const select = () =>
    client.query<ConversationRow>(
      `SELECT * FROM conversations
       WHERE tenant_id = $1 AND whatsapp_account_id = $2 AND customer_identity = $3 AND state <> 'CLOSED'
       FOR UPDATE`,
      [client.tenantId, whatsappAccountId, customerIdentity],
    );

  const existing = await select();
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await client.query<ConversationRow>(
    `INSERT INTO conversations (id, tenant_id, whatsapp_account_id, customer_identity, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (tenant_id, whatsapp_account_id, customer_identity) WHERE state <> 'CLOSED' DO NOTHING
     RETURNING *`,
    [newId('cnv'), client.tenantId, whatsappAccountId, customerIdentity, now],
  );
  if (inserted.rows[0]) return inserted.rows[0];

  const raced = await select();
  if (!raced.rows[0]) throw new Error('conversation vanished after insert conflict');
  return raced.rows[0];
};

// A newer customer message invalidates any in-flight claim, so a draft written for older messages is dropped.
export const recordCustomerMessage = async (client: TenantClient, conversationId: string, sentAt: Date, now: Date) => {
  await client.query(
    `UPDATE conversations
     SET last_message_at = greatest(last_message_at, $3),
         last_customer_message_at = greatest(last_customer_message_at, $4),
         claim_id = NULL, claim_holder = NULL, claim_latest_message_id = NULL, claim_expires_at = NULL,
         updated_at = $3
     WHERE tenant_id = $1 AND id = $2`,
    [client.tenantId, conversationId, now, sentAt],
  );
};

export const applyHumanTakeover = async (
  client: TenantClient,
  conversationId: string,
  now: Date,
  humanPauseHours: number,
): Promise<void> => {
  await client.query(
    `UPDATE conversations
     SET state = 'HUMAN_ACTIVE',
         last_human_reply_at = $3,
         last_message_at = greatest(last_message_at, $3),
         ai_paused_until = greatest(ai_paused_until, $3 + make_interval(hours => $4)),
         claim_id = NULL, claim_holder = NULL, claim_latest_message_id = NULL, claim_expires_at = NULL,
         updated_at = $3
     WHERE tenant_id = $1 AND id = $2 AND state <> 'CLOSED'`,
    [client.tenantId, conversationId, now, humanPauseHours],
  );
};

export const pauseAi = async (client: TenantClient, conversationId: string, now: Date, until: Date) => {
  await client.query(
    `UPDATE conversations
     SET ai_paused_until = greatest(ai_paused_until, $4),
         claim_id = NULL, claim_holder = NULL, claim_latest_message_id = NULL, claim_expires_at = NULL,
         updated_at = $3
     WHERE tenant_id = $1 AND id = $2`,
    [client.tenantId, conversationId, now, until],
  );
};

export type TenantSettingsRow = {
  grace_minutes_open: number;
  grace_minutes_closed: number;
  human_pause_hours: number;
  max_template_messages_per_customer_per_week: number;
  ai_disclosure_enabled: boolean;
  languages: string[];
  timezone: string;
  opening_hours: Record<string, [string, string][]>;
  customer_messages_per_hour_limit: number;
  daily_token_budget: number;
  emergency_message: string | null;
  handoff_message: string | null;
};

export const loadTenantSettings = async (client: TenantClient): Promise<TenantSettingsRow> => {
  const result = await client.query<TenantSettingsRow>('SELECT * FROM tenant_settings WHERE tenant_id = $1', [
    client.tenantId,
  ]);
  if (!result.rows[0]) throw new Error(`tenant settings missing for ${client.tenantId}`);
  return result.rows[0];
};
