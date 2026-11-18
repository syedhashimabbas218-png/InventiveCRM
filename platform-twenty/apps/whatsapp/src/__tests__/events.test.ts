import { describe, expect, it } from 'vitest';

import { messageRecordData } from 'src/lib/events';
import { parseWebhook } from 'src/lib/inventivechat';
import { previewOf } from 'src/lib/rules';

const NOW = Date.parse('2026-11-18T10:00:00.000Z');
const envelope = (type: string, data: Record<string, unknown>) => ({ tenant_id: 'ten_1', actor: { type: 'system', id: 'sys' }, correlation_id: 'cor_abcdefgh', idempotency_key: 'evt_1', occurred_at: '2026-11-18T09:59:00.000Z', payload: { type, data } });

const inbound = {
  id: 'msg_1',
  conversation_id: 'conv_1',
  whatsapp_account_id: 'wac_1',
  customer: '447700900123',
  profile_name: 'Sam Patel',
  direction: 'inbound',
  sender: { type: 'customer', id: '447700900123', name: 'Sam Patel' },
  type: 'text',
  text: 'Hi, is my boiler booked?',
  template: null,
  attachment: null,
  status: 'delivered',
  ai_topic: null,
  imported_from_history: false,
  idempotency_key: null,
  sent_at: null,
  received_at: '2026-11-18T09:58:00.000Z',
};

describe('webhook events to records', () => {
  it('maps a received message onto a conversation and message', () => {
    const parsed = parseWebhook(envelope('message.received', { message: inbound }), undefined, NOW);
    expect(parsed?.tenantId).toBe('ten_1');
    if (parsed?.event.kind !== 'message') throw new Error('expected a message');
    const message = parsed.event.message;
    expect(message).toMatchObject({ conversationId: 'conv_1', messageId: 'msg_1', phone: '+447700900123', waId: '447700900123', profileName: 'Sam Patel', direction: 'INBOUND', messageType: 'TEXT', occurredAt: '2026-11-18T09:58:00.000Z' });
    const record = messageRecordData(message, { id: 'crm-conv', personId: 'crm-person' });
    expect(record).toMatchObject({ conversationId: 'crm-conv', personId: 'crm-person', direction: 'INBOUND', status: 'DELIVERED', sentByName: null, inventiveChatMessageId: 'msg_1', text: 'Hi, is my boiler booked?' });
    expect(record.name).toBe('Hi, is my boiler booked?');
  });

  it('stores a reply typed on the business phone as an outbound message', () => {
    const parsed = parseWebhook(envelope('message.sent', { message: { ...inbound, id: 'msg_2', direction: 'echo', sender: { type: 'human', id: 'phone', name: '' }, sent_at: '2026-11-18T09:59:30.000Z', received_at: null, status: 'sent' } }), undefined, NOW);
    if (parsed?.event.kind !== 'message') throw new Error('expected a message');
    expect(parsed.event.message).toMatchObject({ direction: 'OUTBOUND', fromBusinessPhone: true, senderName: 'Business phone', status: 'SENT', occurredAt: '2026-11-18T09:59:30.000Z' });
  });

  it('keeps our idempotency key and the CRM sender, and maps templates and voice notes', () => {
    const parsed = parseWebhook(
      envelope('message.status_updated', {
        message: { ...inbound, id: 'msg_3', direction: 'outbound', idempotency_key: 'crm_abc_1', sender: { type: 'human', id: 'crm:11111111-1111-4111-8111-111111111111', name: 'Ann' }, type: 'template', template: { name: 'invoice_ready', parameters: { customer_name: 'Sam' } }, status: 'sent' },
        status: 'read',
      }),
      undefined,
      NOW,
    );
    if (parsed?.event.kind !== 'message') throw new Error('expected a message');
    expect(parsed.event.message).toMatchObject({ idempotencyKey: 'crm_abc_1', senderMemberId: '11111111-1111-4111-8111-111111111111', senderName: 'Ann', messageType: 'TEMPLATE', templateName: 'invoice_ready', status: 'READ' });
    const voice = parseWebhook(envelope('message.received', { message: { ...inbound, id: 'msg_4', type: 'audio', text: null, attachment: { id: 'att_1', kind: 'audio', mime_type: 'audio/ogg', filename: 'note.ogg', voice: true, status: 'stored' } } }), undefined, NOW);
    if (voice?.event.kind !== 'message') throw new Error('expected a message');
    expect(voice.event.message).toMatchObject({ messageType: 'MEDIA', mediaKind: 'voice', attachmentId: 'att_1' });
    expect(previewOf(voice.event.message)).toBe('Voice message: note.ogg');
  });

  it("reads a failure from Meta's errors array", () => {
    const parsed = parseWebhook(
      envelope('message.status_updated', { message: { ...inbound, id: 'msg_5', direction: 'outbound', status: 'sent' }, status: 'failed', errors: [{ code: 131026, title: 'Message undeliverable', message: 'Receiver is not on WhatsApp', error_data: { details: 'x' } }] }),
      undefined,
      NOW,
    );
    if (parsed?.event.kind !== 'message') throw new Error('expected a message');
    expect(parsed.event.message).toMatchObject({ status: 'FAILED', error: 'Message undeliverable: Receiver is not on WhatsApp' });
    expect(messageRecordData(parsed.event.message, { id: 'c', personId: null })).toMatchObject({ status: 'FAILED', error: 'Message undeliverable: Receiver is not on WhatsApp' });
  });

  it('reads who is replying from conversation.updated', () => {
    const updated = (data: Record<string, unknown>) => {
      const parsed = parseWebhook(envelope('conversation.updated', { conversation_id: 'conv_1', whatsapp_account_id: 'wac_1', customer: '447700900123', profile_name: 'Sam', customer_waiting: false, ...data }), undefined, NOW);
      if (parsed?.event.kind !== 'conversation_state') throw new Error('expected a state');
      return parsed.event.state;
    };
    expect(updated({ state: 'AI_ACTIVE', automation_replying: true, ai_paused_until: null })).toMatchObject({ handling: 'AI', personActive: false, closed: false, phone: '+447700900123' });
    expect(updated({ state: 'HUMAN_ACTIVE', automation_replying: false, ai_paused_until: null })).toMatchObject({ handling: 'PERSON', personActive: true });
    expect(updated({ state: 'HUMAN_ACTIVE', automation_replying: false, ai_paused_until: '2026-11-18T13:00:00.000Z', customer_waiting: true })).toMatchObject({ handling: 'PERSON', personActive: true, customerWaiting: true, aiPausedUntil: '2026-11-18T13:00:00.000Z' });
    expect(updated({ state: 'HUMAN_ACTIVE', automation_replying: false, ai_paused_until: '2026-11-18T09:00:00.000Z' })).toMatchObject({ handling: null, personActive: false });
    expect(updated({ state: 'AWAITING_APPROVAL', automation_replying: false })).toMatchObject({ handling: 'AWAITING_APPROVAL', personActive: false });
    expect(updated({ state: 'CLOSED', automation_replying: false })).toMatchObject({ closed: true, handling: null });
  });

  it('reads opt-outs and consent with the customer as a bare WhatsApp id', () => {
    expect(parseWebhook(envelope('customer.opted_out', { customer: '447700900123', profile_name: 'Sam' }), undefined, NOW)?.event).toEqual({ kind: 'opted_out', conversationId: null, phone: '+447700900123' });
    expect(parseWebhook(envelope('consent.updated', { customer: '447700900123', consent: false, source: 'customer', at: '2026-11-18T09:00:00Z', opted_out: true }), undefined, NOW)?.event).toEqual({ kind: 'consent', phone: '+447700900123', consent: false, optedOut: true });
    expect(parseWebhook(envelope('conversation.handoff_requested', { conversation_id: 'conv_1' }), undefined, NOW)?.event).toEqual({ kind: 'handling', conversationId: 'conv_1', handling: 'HANDOFF_REQUESTED' });
  });

  it('names a send whose outcome is unknown by our own idempotency key, as InventiveChat stores no message for it', () => {
    const parsed = parseWebhook(envelope('message.send_outcome_unknown', { conversation_id: 'conv_1', idempotency_key: 'crm_abc_1', detail: 'Sending process stopped mid-send' }), undefined, NOW);
    expect(parsed?.event).toEqual({ kind: 'outcome_unknown', idempotencyKey: 'crm_abc_1' });
    expect(parseWebhook(envelope('message.send_outcome_unknown', { conversation_id: 'conv_1' }), undefined, NOW)).toBeNull();
  });

  it('ignores what it does not know and refuses what it cannot read', () => {
    expect(parseWebhook(envelope('template.status_updated', { name: 'x' }), undefined, NOW)?.event).toEqual({ kind: 'ignored', eventType: 'template.status_updated' });
    expect(parseWebhook(envelope('message.received', { message: { id: 'no-conversation' } }), undefined, NOW)).toBeNull();
    expect(parseWebhook({ payload: { type: 'message.received' } }, undefined, NOW)).toBeNull();
    expect(parseWebhook('not json', undefined, NOW)).toBeNull();
  });
});
