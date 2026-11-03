import { withTenant, type Database } from '../db/pool.ts';
import { isAiSendingEnabled, latestInboundMessage } from '../conversations/ai-guards.ts';
import { loadTenantSettings } from '../conversations/conversation-store.ts';
import type { EventBus } from '../interfaces/event-bus.ts';
import type { JobHandler } from '../jobs/worker.ts';
import { graceMinutesAt, type OpeningHours } from '../messaging/opening-hours.ts';
import type { Clock } from '../shared/clock.ts';
import { newId } from '../shared/ids.ts';

// Fires once the grace period and debounce have passed for the latest customer message, so providers
// get one "answer now" signal per burst instead of reacting to every message.
export const createReadyForReplyHandler =
  (deps: { database: Database; clock: Clock; eventBus: EventBus }): JobHandler =>
  async (job) => {
    const now = deps.clock();
    const conversationId = String(job.payload.conversation_id);
    const messageId = String(job.payload.message_id);

    const ready = await withTenant(deps.database, job.tenant_id, async (client) => {
      const conversation = (
        await client.query<{ state: string; ai_paused_until: Date | null; customer_identity: string }>(
          'SELECT state, ai_paused_until, customer_identity FROM conversations WHERE tenant_id = $1 AND id = $2',
          [job.tenant_id, conversationId],
        )
      ).rows[0];
      if (!conversation || conversation.state === 'CLOSED' || conversation.state === 'AWAITING_APPROVAL') return undefined;
      if (conversation.state === 'HUMAN_ACTIVE' && (!conversation.ai_paused_until || conversation.ai_paused_until > now)) return undefined;
      if (conversation.state === 'AI_ACTIVE' && conversation.ai_paused_until && conversation.ai_paused_until > now) return undefined;
      if (!(await isAiSendingEnabled(client))) return undefined;

      const latest = await latestInboundMessage(client, conversationId);
      if (latest?.id !== messageId) return undefined;
      if (latest.provider_sent_at) {
        const settings = await loadTenantSettings(client);
        const graceEnds =
          latest.provider_sent_at.getTime() +
          graceMinutesAt({ ...settings, opening_hours: settings.opening_hours as OpeningHours }, latest.provider_sent_at) * 60_000;
        if (graceEnds > now.getTime()) return { retryAt: new Date(graceEnds) };
      }
      return { customerIdentity: conversation.customer_identity };
    });

    if (!ready) return;
    if ('retryAt' in ready) return { retryAt: ready.retryAt };
    await deps.eventBus.publish({
      tenant_id: job.tenant_id,
      actor: { type: 'system', id: 'messaging-service' },
      correlation_id: newId('cor'),
      idempotency_key: `conversation.ready_for_reply:${messageId}`,
      occurred_at: now.toISOString(),
      payload: {
        type: 'conversation.ready_for_reply',
        data: { conversation_id: conversationId, latest_message_id: messageId, customer: ready.customerIdentity },
      },
    });
  };
