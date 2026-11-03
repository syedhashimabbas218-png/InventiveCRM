import type { TenantClient } from '../db/pool.ts';

export const isAiSendingEnabled = async (client: TenantClient): Promise<boolean> => {
  const result = await client.query<{ enabled: boolean }>(
    `SELECT p.ai_sending_enabled AND t.ai_sending_enabled AND t.status = 'active' AS enabled
     FROM platform_settings p CROSS JOIN tenants t WHERE t.id = $1`,
    [client.tenantId],
  );
  return result.rows[0]?.enabled === true;
};

export const latestInboundMessage = async (
  client: TenantClient,
  conversationId: string,
): Promise<{ id: string; provider_sent_at: Date | null } | undefined> => {
  const result = await client.query<{ id: string; provider_sent_at: Date | null }>(
    `SELECT id, provider_sent_at FROM messages
     WHERE tenant_id = $1 AND conversation_id = $2 AND direction = 'inbound'
     ORDER BY seq DESC LIMIT 1`,
    [client.tenantId, conversationId],
  );
  return result.rows[0];
};
