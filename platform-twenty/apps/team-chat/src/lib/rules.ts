export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_LINKS = 5;
export const MAX_MENTIONS = 20;
export const MESSAGES_PER_MINUTE = 30;
export const CHANNELS_PER_HOUR = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

export const LINKABLE_OBJECTS = ['person', 'company', 'opportunity'] as const;

export type RecordLink = { objectNameSingular: string; recordId: string; label: string };

export const cleanBody = (value: unknown) => (typeof value === 'string' ? value.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, MAX_MESSAGE_LENGTH) : '');

export const cleanLinks = (value: unknown): RecordLink[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const links: RecordLink[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const { objectNameSingular, recordId, label } = item as Record<string, unknown>;
    if (typeof objectNameSingular !== 'string' || !/^[a-zA-Z][a-zA-Z0-9]{0,62}$/.test(objectNameSingular) || !isUuid(recordId) || seen.has(recordId)) continue;
    seen.add(recordId);
    links.push({ objectNameSingular, recordId, label: typeof label === 'string' ? label.slice(0, 200) : '' });
    if (links.length === MAX_LINKS) break;
  }
  return links;
};

// Only people who can see the channel can be mentioned, each once.
export const cleanMentions = (value: unknown, allowed: Set<string>) =>
  Array.isArray(value) ? [...new Set(value.filter((id): id is string => isUuid(id) && allowed.has(id)))].slice(0, MAX_MENTIONS) : [];

export const channelName = (value: unknown) =>
  typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40)
    : '';

