export type MediaType = 'image' | 'audio' | 'video' | 'document' | 'sticker';

export type MessageContent =
  | { kind: 'text'; text: string }
  | { kind: 'reply'; replyId: string; title: string }
  | {
      kind: 'media';
      mediaType: MediaType;
      providerMediaId: string;
      mimeType: string;
      sha256?: string;
      caption?: string;
      voice?: boolean;
      filename?: string;
    }
  | { kind: 'unsupported'; providerType: string };

export type InboundMessageEvent = {
  kind: 'inbound_message';
  businessAccountId: string;
  phoneNumberId: string;
  providerMessageId: string;
  from: string;
  profileName?: string;
  sentAt: Date;
  replyToProviderMessageId?: string;
  content: MessageContent;
};

export type EchoEvent = {
  kind: 'echo';
  businessAccountId: string;
  phoneNumberId: string;
  providerMessageId: string;
  from: string;
  to: string;
  sentAt: Date;
  content: MessageContent;
};

export type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

export type StatusEvent = {
  kind: 'status';
  businessAccountId: string;
  phoneNumberId: string;
  providerMessageId: string;
  status: DeliveryStatus;
  recipientId: string;
  at: Date;
  errors?: unknown[];
};

export type IgnoredEvent = {
  kind: 'ignored';
  reason: string;
};

export type NormalisedEvent = InboundMessageEvent | EchoEvent | StatusEvent | IgnoredEvent;

// The text the agent treats as the customer's words. Always untrusted.
export const contentAsText = (content: MessageContent): string => {
  switch (content.kind) {
    case 'text':
      return content.text;
    case 'reply':
      return content.title;
    case 'media':
      return content.caption ?? '';
    case 'unsupported':
      return '';
  }
};
