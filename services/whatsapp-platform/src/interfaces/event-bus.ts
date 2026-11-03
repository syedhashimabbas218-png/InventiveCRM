import type { Envelope } from '../envelope/envelope.ts';

// n8n and other subscribers consume these through the connector (file 04); this service only publishes.
export type BusinessEventType =
  | 'message.received'
  | 'message.sent'
  | 'conversation.human_takeover'
  | 'conversation.handoff_requested'
  | 'booking.created'
  | 'booking.rescheduled'
  | 'booking.cancelled'
  | 'customer.opted_out'
  | 'agent.limit_reached';

export type BusinessEvent = Envelope<{ type: BusinessEventType; data: Record<string, unknown> }>;

export type EventBus = {
  publish: (event: BusinessEvent) => Promise<void>;
};
