import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normaliseWebhook } from '../src/messaging/normalise.ts';
import { buttonReply, messageEcho, statusUpdate, textMessage, voiceNote } from './helpers/webhook-fixtures.ts';

const base = { wabaId: '102290129340398', phoneNumberId: '106540352242922', timestamp: new Date('2026-11-03T10:00:00Z') };

describe('normaliseWebhook', () => {
  it('normalises a text message with the profile name', () => {
    const [event] = normaliseWebhook(textMessage({ ...base, from: '447700900123', id: 'wamid.1', text: 'Hi there' }));
    assert.deepEqual(event, {
      kind: 'inbound_message',
      businessAccountId: base.wabaId,
      phoneNumberId: base.phoneNumberId,
      providerMessageId: 'wamid.1',
      from: '447700900123',
      profileName: 'Sheena Nelson',
      sentAt: base.timestamp,
      replyToProviderMessageId: undefined,
      content: { kind: 'text', text: 'Hi there' },
    });
  });

  it('normalises an interactive button reply', () => {
    const [event] = normaliseWebhook(
      buttonReply({ ...base, from: '447700900123', id: 'wamid.2', replyId: 'confirm:pa_1', title: 'Confirm' }),
    );
    assert.equal(event?.kind, 'inbound_message');
    assert.deepEqual(event?.kind === 'inbound_message' && event.content, { kind: 'reply', replyId: 'confirm:pa_1', title: 'Confirm' });
  });

  it('normalises a voice note as media with the voice flag', () => {
    const [event] = normaliseWebhook(voiceNote({ ...base, from: '447700900123', id: 'wamid.3' }));
    assert.equal(event?.kind === 'inbound_message' && event.content.kind === 'media' && event.content.voice, true);
  });

  it('normalises a status and an echo', () => {
    const [status] = normaliseWebhook(statusUpdate({ ...base, id: 'wamid.4', status: 'delivered', recipient: '447700900123' }));
    assert.equal(status?.kind, 'status');
    const [echo] = normaliseWebhook(messageEcho({ ...base, from: '447700900000', to: '447700900123', id: 'wamid.5', text: 'On my way' }));
    assert.deepEqual(echo?.kind === 'echo' && [echo.from, echo.to], ['447700900000', '447700900123']);
  });

  it('ignores other objects, unknown fields and malformed entries without throwing', () => {
    assert.deepEqual(normaliseWebhook({ object: 'page' }), [{ kind: 'ignored', reason: 'not_a_whatsapp_business_account_payload' }]);
    assert.deepEqual(normaliseWebhook(null), [{ kind: 'ignored', reason: 'not_a_whatsapp_business_account_payload' }]);
    const history = { object: 'whatsapp_business_account', entry: [{ id: 'w', changes: [{ field: 'history', value: { metadata: { phone_number_id: 'p' } } }] }] };
    assert.deepEqual(normaliseWebhook(history), [{ kind: 'ignored', reason: 'unhandled_field:history' }]);
    const badTimestamp = textMessage({ ...base, from: '447700900123', id: 'wamid.6', text: 'x' });
    (badTimestamp.entry[0]!.changes[0]!.value as unknown as { messages: { timestamp: string }[] }).messages[0]!.timestamp = 'yesterday';
    assert.deepEqual(normaliseWebhook(badTimestamp), [{ kind: 'ignored', reason: 'malformed_message' }]);
  });

  it('keeps unknown message types as unsupported rather than dropping them', () => {
    const payload = textMessage({ ...base, from: '447700900123', id: 'wamid.7', text: 'x' });
    const message = (payload.entry[0]!.changes[0]!.value as unknown as { messages: Record<string, unknown>[] }).messages[0]!;
    message.type = 'location';
    delete message.text;
    const [event] = normaliseWebhook(payload);
    assert.deepEqual(event?.kind === 'inbound_message' && event.content, { kind: 'unsupported', providerType: 'location' });
  });
});
