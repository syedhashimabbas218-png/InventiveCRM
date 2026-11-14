export const CAMPAIGN_CHANNELS = {
  EMAIL: { label: 'Email', color: 'blue' },
  WHATSAPP: { label: 'WhatsApp', color: 'green' },
} as const;

export const CAMPAIGN_STATUSES = {
  DRAFT: { label: 'Draft', color: 'gray' },
  SCHEDULED: { label: 'Scheduled', color: 'blue' },
  SENDING: { label: 'Sending', color: 'sky' },
  SENT: { label: 'Sent', color: 'green' },
  CANCELLED: { label: 'Cancelled', color: 'gray' },
  FAILED: { label: 'Failed', color: 'red' },
} as const;

export const RECIPIENT_STATUSES = {
  QUEUED: { label: 'Queued', color: 'gray' },
  SENT: { label: 'Sent', color: 'blue' },
  DELIVERED: { label: 'Delivered', color: 'green' },
  BOUNCED: { label: 'Bounced', color: 'red' },
  COMPLAINED: { label: 'Marked as spam', color: 'red' },
  UNSUBSCRIBED: { label: 'Unsubscribed', color: 'orange' },
  FAILED: { label: 'Failed', color: 'red' },
  SKIPPED: { label: 'Skipped', color: 'gray' },
} as const;

export const SUPPRESSION_REASONS = {
  UNSUBSCRIBED: { label: 'Unsubscribed', color: 'orange' },
  BOUNCED: { label: 'Hard bounce', color: 'red' },
  COMPLAINED: { label: 'Marked as spam', color: 'red' },
  MANUAL: { label: 'Added by hand', color: 'gray' },
} as const;

export const TEMPLATE_CATEGORIES = {
  NEWSLETTER: { label: 'Newsletter', color: 'blue' },
  PROMOTION: { label: 'Offer', color: 'orange' },
  EVENT: { label: 'Event', color: 'purple' },
  ANNOUNCEMENT: { label: 'Announcement', color: 'sky' },
  OTHER: { label: 'Other', color: 'gray' },
} as const;

export type CampaignChannel = keyof typeof CAMPAIGN_CHANNELS;
export type CampaignStatus = keyof typeof CAMPAIGN_STATUSES;
export type RecipientStatus = keyof typeof RECIPIENT_STATUSES;
export type SuppressionReason = keyof typeof SUPPRESSION_REASONS;

type OptionColor = 'blue' | 'sky' | 'green' | 'gray' | 'orange' | 'red' | 'purple';

export const selectOptions = (entries: Record<string, string | { label: string; color?: string }>) =>
  Object.entries(entries).map(([value, entry], position) => ({
    value,
    label: typeof entry === 'string' ? entry : entry.label,
    color: (typeof entry === 'string' ? 'gray' : (entry.color ?? 'gray')) as OptionColor,
    position,
  }));
