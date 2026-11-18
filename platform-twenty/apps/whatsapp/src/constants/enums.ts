export const CONVERSATION_STATUSES = {
  OPEN: { label: 'Open', color: 'green' },
  CLOSED: { label: 'Closed', color: 'gray' },
} as const;

export const CONVERSATION_HANDLING = {
  AI: { label: 'AI replying', color: 'purple' },
  PERSON: { label: 'A person', color: 'blue' },
  HANDOFF_REQUESTED: { label: 'Wants a person', color: 'orange' },
  AWAITING_APPROVAL: { label: 'Automation awaiting approval', color: 'gray' },
} as const;

export const MESSAGE_DIRECTIONS = {
  INBOUND: { label: 'From the customer', color: 'blue' },
  OUTBOUND: { label: 'From us', color: 'green' },
} as const;

export const MESSAGE_TYPES = {
  TEXT: { label: 'Text', color: 'gray' },
  TEMPLATE: { label: 'Template', color: 'purple' },
  MEDIA: { label: 'Media', color: 'blue' },
  BUTTONS: { label: 'Buttons', color: 'orange' },
  OTHER: { label: 'Other', color: 'gray' },
} as const;

export const MESSAGE_STATUSES = {
  QUEUED: { label: 'Queued', color: 'gray' },
  SENT: { label: 'Sent', color: 'blue' },
  DELIVERED: { label: 'Delivered', color: 'green' },
  READ: { label: 'Read', color: 'green' },
  FAILED: { label: 'Failed', color: 'red' },
} as const;

export type ConversationStatus = keyof typeof CONVERSATION_STATUSES;
export type ConversationHandling = keyof typeof CONVERSATION_HANDLING;
export type MessageDirection = keyof typeof MESSAGE_DIRECTIONS;
export type MessageType = keyof typeof MESSAGE_TYPES;
export type MessageStatus = keyof typeof MESSAGE_STATUSES;

type OptionColor = 'blue' | 'green' | 'orange' | 'purple' | 'gray' | 'red';

export const selectOptions = (entries: Record<string, string | { label: string; color?: string }>) =>
  Object.entries(entries).map(([value, entry], position) => ({
    value,
    label: typeof entry === 'string' ? entry : entry.label,
    color: (typeof entry === 'string' ? 'gray' : (entry.color ?? 'gray')) as OptionColor,
    position,
  }));
