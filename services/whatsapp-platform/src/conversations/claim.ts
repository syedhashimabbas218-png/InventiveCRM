import { withTenant, type Database } from '../db/pool.ts';
import { graceMinutesAt, type OpeningHours } from '../messaging/opening-hours.ts';
import type { Clock } from '../shared/clock.ts';
import { newId } from '../shared/ids.ts';
import { isAiSendingEnabled, latestInboundMessage } from './ai-guards.ts';
import { loadTenantSettings, lockConversation } from './conversation-store.ts';

export const MAX_CLAIM_TTL_SECONDS = 300;

export type ClaimRequest = {
  conversationId: string;
  claimant: 'ai';
  latestMessageId: string | null;
  ttlSeconds: number;
};

export type ClaimRefusalReason = 'human_active' | 'newer_message' | 'already_claimed' | 'paused';

export type ClaimResult =
  | { claimed: true; claimId: string; expiresAt: Date }
  | { claimed: false; reason: ClaimRefusalReason; retryAfterSeconds?: number }
  | { claimed: false; reason: 'not_found' };

export const claimConversation = async (
  deps: { database: Database; clock: Clock },
  tenantId: string,
  request: ClaimRequest,
): Promise<ClaimResult> =>
  withTenant(deps.database, tenantId, async (client) => {
    const now = deps.clock();
    const conversation = await lockConversation(client, request.conversationId);
    if (!conversation) return { claimed: false, reason: 'not_found' };

    if (!(await isAiSendingEnabled(client))) return { claimed: false, reason: 'paused' };
    if (conversation.state === 'CLOSED' || conversation.state === 'AWAITING_APPROVAL') {
      return { claimed: false, reason: 'paused' };
    }

    const pausedUntil = conversation.ai_paused_until;
    if (conversation.state === 'HUMAN_ACTIVE') {
      if (!pausedUntil || pausedUntil > now) return { claimed: false, reason: 'human_active' };
      await client.query(
        "UPDATE conversations SET state = 'AI_ACTIVE', updated_at = $3 WHERE tenant_id = $1 AND id = $2",
        [tenantId, conversation.id, now],
      );
    } else if (pausedUntil && pausedUntil > now) {
      return {
        claimed: false,
        reason: 'paused',
        retryAfterSeconds: Math.ceil((pausedUntil.getTime() - now.getTime()) / 1000),
      };
    }

    const latest = await latestInboundMessage(client, conversation.id);
    if ((latest?.id ?? null) !== request.latestMessageId) {
      return { claimed: false, reason: 'newer_message' };
    }

    if (conversation.claim_id && conversation.claim_expires_at && conversation.claim_expires_at > now) {
      return { claimed: false, reason: 'already_claimed' };
    }

    // Enforced here too, so a caller that skips the wait still cannot answer before a human can.
    if (latest?.provider_sent_at) {
      const settings = await loadTenantSettings(client);
      const graceEnds =
        latest.provider_sent_at.getTime() +
        graceMinutesAt({ ...settings, opening_hours: settings.opening_hours as OpeningHours }, latest.provider_sent_at) * 60_000;
      if (graceEnds > now.getTime()) {
        return { claimed: false, reason: 'paused', retryAfterSeconds: Math.ceil((graceEnds - now.getTime()) / 1000) };
      }
    }

    const claimId = newId('clm');
    const expiresAt = new Date(now.getTime() + Math.min(request.ttlSeconds, MAX_CLAIM_TTL_SECONDS) * 1000);
    await client.query(
      `UPDATE conversations
       SET claim_id = $3, claim_holder = $4, claim_latest_message_id = $5, claim_expires_at = $6, updated_at = $7
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, conversation.id, claimId, request.claimant, request.latestMessageId, expiresAt, now],
    );
    return { claimed: true, claimId, expiresAt };
  });

export const releaseClaim = async (
  deps: { database: Database; clock: Clock },
  tenantId: string,
  conversationId: string,
  claimId: string,
): Promise<void> => {
  await withTenant(deps.database, tenantId, (client) =>
    client.query(
      `UPDATE conversations
       SET claim_id = NULL, claim_holder = NULL, claim_latest_message_id = NULL, claim_expires_at = NULL, updated_at = $4
       WHERE tenant_id = $1 AND id = $2 AND claim_id = $3`,
      [tenantId, conversationId, claimId, deps.clock()],
    ),
  );
};
