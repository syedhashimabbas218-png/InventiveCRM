import { signWebhookBody } from '../../src/messaging/signature.ts';
import { newId } from '../../src/shared/ids.ts';
import type { SeededTenant } from './fixtures.ts';
import { TEST_APP_SECRET, type TestContext } from './test-context.ts';
import { messageEcho, textMessage } from './webhook-fixtures.ts';

let messageSequence = 0;

export const createApiClient = (context: TestContext) => {
  const postWebhook = (payload: unknown) => {
    const raw = JSON.stringify(payload);
    return context.app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signWebhookBody(TEST_APP_SECRET, raw) },
      payload: raw,
    });
  };

  const customerSays = async (tenant: SeededTenant, customer: string, text: string) => {
    const response = await postWebhook(
      textMessage({
        wabaId: tenant.wabaId,
        phoneNumberId: tenant.phoneNumberId,
        timestamp: context.now,
        from: customer,
        id: `wamid.c${process.pid}x${++messageSequence}`,
        text,
      }),
    );
    const outcome = response.json().outcomes[0];
    return { conversationId: outcome.conversationId as string, messageId: outcome.messageId as string, outcome };
  };

  const ownerEchoes = (tenant: SeededTenant, customer: string, text: string) =>
    postWebhook(
      messageEcho({
        wabaId: tenant.wabaId,
        phoneNumberId: tenant.phoneNumberId,
        timestamp: context.now,
        from: tenant.businessNumber,
        to: customer,
        id: `wamid.e${process.pid}x${++messageSequence}`,
        text,
      }),
    );

  const envelope = (
    tenantId: string,
    actor: { type: 'user' | 'agent' | 'system'; id: string },
    payload: Record<string, unknown>,
    idempotencyKey = newId('cor'),
  ) => ({
    tenant_id: tenantId,
    actor,
    correlation_id: newId('cor'),
    idempotency_key: idempotencyKey,
    occurred_at: context.now.toISOString(),
    payload,
  });

  const call = (url: string, token: string, body: unknown) =>
    context.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload: body as object });

  const claim = (tenant: SeededTenant, conversationId: string, latestMessageId: string | null, options: { token?: string; tenantId?: string } = {}) =>
    call(
      `/v1/conversations/${conversationId}/claim`,
      options.token ?? tenant.apiToken,
      envelope(options.tenantId ?? tenant.tenantId, { type: 'agent', id: 'agent' }, {
        claimant: 'ai',
        latest_message_id: latestMessageId,
        ttl_seconds: 120,
      }),
    );

  const aiSend = (
    tenant: SeededTenant,
    conversationId: string,
    claimId: string | undefined,
    body: string,
    options: { idempotencyKey?: string; token?: string; tenantId?: string } = {},
  ) =>
    call(
      '/v1/messages/send',
      options.token ?? tenant.apiToken,
      envelope(
        options.tenantId ?? tenant.tenantId,
        { type: 'agent', id: 'agent' },
        { conversation_id: conversationId, claim_id: claimId, type: 'text', body },
        options.idempotencyKey,
      ),
    );

  const humanSend = (tenant: SeededTenant, conversationId: string, body: string) =>
    call(
      '/v1/messages/send',
      tenant.inboxToken,
      envelope(tenant.tenantId, { type: 'user', id: 'usr_owner' }, { conversation_id: conversationId, type: 'text', body }),
    );

  return { postWebhook, customerSays, ownerEchoes, envelope, call, claim, aiSend, humanSend };
};
