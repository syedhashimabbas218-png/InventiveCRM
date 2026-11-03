import type {
  DeliveryStatus,
  MediaType,
  MessageContent,
  NormalisedEvent,
} from './normalised-event.ts';

type JsonObject = Record<string, unknown>;

const MEDIA_TYPES: readonly MediaType[] = ['image', 'audio', 'video', 'document', 'sticker'];
const DELIVERY_STATUSES: readonly DeliveryStatus[] = ['sent', 'delivered', 'read', 'failed'];

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asObjects = (value: unknown): JsonObject[] => (Array.isArray(value) ? value.filter(isObject) : []);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const parseUnixSeconds = (value: unknown): Date | undefined => {
  const text = asString(value);
  if (!text || !/^\d{1,12}$/.test(text)) {
    return undefined;
  }
  return new Date(Number(text) * 1000);
};

const parseContent = (message: JsonObject): MessageContent => {
  const type = asString(message.type) ?? 'unknown';

  if (type === 'text') {
    const text = asString(isObject(message.text) ? message.text.body : undefined);
    return text ? { kind: 'text', text } : { kind: 'unsupported', providerType: type };
  }

  if (type === 'interactive' && isObject(message.interactive)) {
    const interactive = message.interactive;
    const reply = isObject(interactive.button_reply)
      ? interactive.button_reply
      : isObject(interactive.list_reply)
        ? interactive.list_reply
        : undefined;
    const replyId = asString(reply?.id);
    if (reply && replyId) {
      return { kind: 'reply', replyId, title: asString(reply.title) ?? '' };
    }
    return { kind: 'unsupported', providerType: `interactive:${asString(interactive.type) ?? 'unknown'}` };
  }

  if (type === 'button' && isObject(message.button)) {
    const replyId = asString(message.button.payload);
    if (replyId) {
      return { kind: 'reply', replyId, title: asString(message.button.text) ?? '' };
    }
  }

  if (MEDIA_TYPES.includes(type as MediaType) && isObject(message[type])) {
    const media = message[type] as JsonObject;
    const providerMediaId = asString(media.id);
    const mimeType = asString(media.mime_type);
    if (providerMediaId && mimeType) {
      return {
        kind: 'media',
        mediaType: type as MediaType,
        providerMediaId,
        mimeType,
        sha256: asString(media.sha256),
        caption: asString(media.caption),
        voice: media.voice === true ? true : undefined,
        filename: asString(media.filename),
      };
    }
  }

  return { kind: 'unsupported', providerType: type };
};

export const normaliseWebhook = (body: unknown): NormalisedEvent[] => {
  if (!isObject(body) || body.object !== 'whatsapp_business_account') {
    return [{ kind: 'ignored', reason: 'not_a_whatsapp_business_account_payload' }];
  }

  const events: NormalisedEvent[] = [];

  for (const entry of asObjects(body.entry)) {
    const businessAccountId = asString(entry.id);
    for (const change of asObjects(entry.changes)) {
      const field = asString(change.field) ?? 'unknown';
      const value = isObject(change.value) ? change.value : undefined;
      const phoneNumberId = asString(isObject(value?.metadata) ? value.metadata.phone_number_id : undefined);

      if (!value || !businessAccountId || !phoneNumberId) {
        events.push({ kind: 'ignored', reason: `malformed_change:${field}` });
        continue;
      }

      if (field === 'messages') {
        const profileNames = new Map<string, string>();
        for (const contact of asObjects(value.contacts)) {
          const waId = asString(contact.wa_id);
          const name = asString(isObject(contact.profile) ? contact.profile.name : undefined);
          if (waId && name) profileNames.set(waId, name);
        }

        for (const message of asObjects(value.messages)) {
          const providerMessageId = asString(message.id);
          const from = asString(message.from);
          const sentAt = parseUnixSeconds(message.timestamp);
          if (!providerMessageId || !from || !sentAt) {
            events.push({ kind: 'ignored', reason: 'malformed_message' });
            continue;
          }
          events.push({
            kind: 'inbound_message',
            businessAccountId,
            phoneNumberId,
            providerMessageId,
            from,
            profileName: profileNames.get(from),
            sentAt,
            replyToProviderMessageId: asString(isObject(message.context) ? message.context.id : undefined),
            content: parseContent(message),
          });
        }

        for (const status of asObjects(value.statuses)) {
          const providerMessageId = asString(status.id);
          const statusValue = asString(status.status) as DeliveryStatus | undefined;
          const at = parseUnixSeconds(status.timestamp);
          if (!providerMessageId || !statusValue || !DELIVERY_STATUSES.includes(statusValue) || !at) {
            events.push({ kind: 'ignored', reason: 'malformed_status' });
            continue;
          }
          events.push({
            kind: 'status',
            businessAccountId,
            phoneNumberId,
            providerMessageId,
            status: statusValue,
            recipientId: asString(status.recipient_id) ?? '',
            at,
            errors: Array.isArray(status.errors) ? status.errors : undefined,
          });
        }
        continue;
      }

      if (field === 'smb_message_echoes') {
        for (const echo of asObjects(value.message_echoes)) {
          const providerMessageId = asString(echo.id);
          const from = asString(echo.from);
          const to = asString(echo.to);
          const sentAt = parseUnixSeconds(echo.timestamp);
          if (!providerMessageId || !from || !to || !sentAt) {
            events.push({ kind: 'ignored', reason: 'malformed_echo' });
            continue;
          }
          events.push({
            kind: 'echo',
            businessAccountId,
            phoneNumberId,
            providerMessageId,
            from,
            to,
            sentAt,
            content: parseContent(echo),
          });
        }
        continue;
      }

      events.push({ kind: 'ignored', reason: `unhandled_field:${field}` });
    }
  }

  return events;
};
