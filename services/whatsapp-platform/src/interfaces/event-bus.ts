import type { Envelope } from '../envelope/envelope.ts';

export const BUSINESS_EVENT_TYPES = [
  'message.received',
  'message.sent',
  'message.status_updated',
  'message.send_outcome_unknown',
  'conversation.ready_for_reply',
  'conversation.human_takeover',
  'conversation.handoff_requested',
  'customer.opted_out',
  'template.status_updated',
] as const;

export type BusinessEventType = (typeof BUSINESS_EVENT_TYPES)[number];

export type BusinessEvent = Envelope<{ type: BusinessEventType; data: Record<string, unknown> }>;

export type EventBus = {
  publish: (event: BusinessEvent) => Promise<void>;
};
