import { type MessageStatus, type MessageType } from 'src/constants/enums';

export const WINDOW_MS = 24 * 60 * 60 * 1000;
export const SENDS_PER_MINUTE = 30;
export const MAX_TEXT_LENGTH = 4096;
export const MAX_TEMPLATE_PARAMETERS = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

export const cleanText = (value: unknown) => (typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim().slice(0, MAX_TEXT_LENGTH) : '');

const RANK: Record<MessageStatus, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 1 };

// Statuses only move forward, so late or repeated webhooks are harmless. A failure can only follow a message that
// was not yet delivered; a delivery or read report after a failure wins, because it proves the message arrived.
export const canMoveStatus = (from: MessageStatus | null, to: MessageStatus) => {
  if (from === null) return true;
  if (from === to) return false;
  if (to === 'FAILED') return from === 'QUEUED' || from === 'SENT';
  return RANK[to] > RANK[from];
};

export const STATUSES: MessageStatus[] = ['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED'];

export const statusesThatCanMoveTo = (to: MessageStatus) => STATUSES.filter((from) => canMoveStatus(from, to));

export const windowExpiresAt = (lastInboundAt: string) => new Date(Date.parse(lastInboundAt) + WINDOW_MS).toISOString();

export const isWindowOpen = (expiresAt: string | null | undefined, now = Date.now()) => Boolean(expiresAt && Date.parse(expiresAt) > now);

const MEDIA_LABELS: Record<string, string> = { image: 'Photo', video: 'Video', audio: 'Audio', voice: 'Voice message', document: 'Document', sticker: 'Sticker' };

export type MessageContent = { messageType: MessageType; text: string | null; templateName: string | null; mediaKind: string | null; mediaFilename: string | null };

export const previewOf = ({ messageType, text, templateName, mediaKind, mediaFilename }: MessageContent, length = 140) => {
  const media = mediaKind ? (MEDIA_LABELS[mediaKind] ?? 'Attachment') : null;
  const body = text?.trim() || (messageType === 'TEMPLATE' && templateName ? `Template: ${templateName}` : '') || (media ? `${media}${mediaFilename ? `: ${mediaFilename}` : ''}` : '') || 'Message';
  const single = body.replace(/\s+/g, ' ');
  return single.length > length ? `${single.slice(0, length - 1)}…` : single;
};

const PARAMETER_NAME = /^[A-Za-z0-9_]{1,64}$/;

// Template values keyed by parameter name, as InventiveChat expects them.
export const templateValues = (value: unknown) => {
  const values: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return values;
  for (const [name, entry] of Object.entries(value as Record<string, unknown>).slice(0, MAX_TEMPLATE_PARAMETERS))
    if (PARAMETER_NAME.test(name) && (typeof entry === 'string' || typeof entry === 'number')) values[name] = String(entry).slice(0, 1024);
  return values;
};

export const isTemplateName = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9_]{1,512}$/.test(value);

export const isLanguageCode = (value: unknown): value is string => typeof value === 'string' && /^[a-z]{2,3}(_[A-Za-z]{2,4})?$/.test(value);
