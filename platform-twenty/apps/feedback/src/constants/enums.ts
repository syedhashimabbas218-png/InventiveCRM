import { IDS } from 'src/constants/ids';

// New options carry an explicit id. The original ones keep the id the CLI derives from their label: giving them
// another id now would make the server rebuild the column without their values.
export const REQUEST_STATUSES = {
  SCHEDULED: { label: 'Scheduled', color: 'gray' },
  SENDING: { label: 'Sending', color: 'sky', id: IDS.request.statusOptions.sending },
  SENT: { label: 'Sent', color: 'blue' },
  ANSWERED: { label: 'Answered', color: 'green' },
  FAILED: { label: 'Failed', color: 'red' },
  SKIPPED: { label: 'Skipped', color: 'gray' },
  EXPIRED: { label: 'Expired', color: 'orange' },
} as const;

export const CHANNELS = {
  EMAIL: { label: 'Email', color: 'blue' },
  WHATSAPP: { label: 'WhatsApp', color: 'green' },
  EMAIL_AND_WHATSAPP: { label: 'Email and WhatsApp', color: 'sky' },
} as const;

export const SOURCES = {
  APPOINTMENT: { label: 'Appointment completed', color: 'purple' },
  INVOICE: { label: 'Invoice paid', color: 'green' },
  MANUAL: { label: 'Sent by hand', color: 'gray' },
} as const;

export type RequestStatus = keyof typeof REQUEST_STATUSES;
export type Channel = keyof typeof CHANNELS;
export type Source = keyof typeof SOURCES;

type OptionColor = 'blue' | 'sky' | 'green' | 'gray' | 'orange' | 'red' | 'purple';

export const selectOptions = (entries: Record<string, string | { label: string; color?: string; id?: string }>) =>
  Object.entries(entries).map(([value, entry], position) => ({
    ...(typeof entry !== 'string' && entry.id ? { id: entry.id } : {}),
    value,
    label: typeof entry === 'string' ? entry : entry.label,
    color: (typeof entry === 'string' ? 'gray' : (entry.color ?? 'gray')) as OptionColor,
    position,
  }));
