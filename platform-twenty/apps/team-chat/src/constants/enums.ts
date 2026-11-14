export const CHANNEL_KINDS = {
  CHANNEL: { label: 'Channel', color: 'blue' },
  DIRECT: { label: 'Direct message', color: 'purple' },
} as const;

export const CHANNEL_VISIBILITIES = {
  PUBLIC: { label: 'Everyone in the workspace', color: 'green' },
  PRIVATE: { label: 'Invited people only', color: 'orange' },
} as const;

export type ChannelKind = keyof typeof CHANNEL_KINDS;
export type ChannelVisibility = keyof typeof CHANNEL_VISIBILITIES;

type OptionColor = 'blue' | 'green' | 'orange' | 'purple' | 'gray';

export const selectOptions = (entries: Record<string, string | { label: string; color?: string }>) =>
  Object.entries(entries).map(([value, entry], position) => ({
    value,
    label: typeof entry === 'string' ? entry : entry.label,
    color: (typeof entry === 'string' ? 'gray' : (entry.color ?? 'gray')) as OptionColor,
    position,
  }));
