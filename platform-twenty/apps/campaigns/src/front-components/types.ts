import { type Brand, type Design } from 'src/lib/design';

export type CampaignSummary = {
  id: string;
  name: string;
  channel: 'EMAIL' | 'WHATSAPP';
  status: 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELLED' | 'FAILED';
  subject: string | null;
  listName: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  sentAt: string | null;
  lastError: string | null;
  updatedAt: string;
  recipientCount: number | null;
  sentCount: number | null;
  deliveredCount: number | null;
  openedCount: number | null;
  clickedCount: number | null;
  bouncedCount: number | null;
  complainedCount: number | null;
  unsubscribedCount: number | null;
  failedCount: number | null;
  skippedCount: number | null;
};

export type Domain = { id: string; name: string; status: string; openTracking: boolean; clickTracking: boolean };

export type MailingList = { id: string; name: string; description: string | null; memberCount: number | null };

export type TemplateSummary = { id: string; name: string; category: string; description: string; starter: boolean };

export type Overview = {
  resend: { connected: boolean; label: string | null; reachable: boolean; webhookReady: boolean; domains: Domain[] };
  whatsappEnabled: boolean;
  brand: Brand & { id: string | null };
  fonts: string[];
  campaigns: CampaignSummary[];
  lists: MailingList[];
  templates: TemplateSummary[];
  audience: { emailConsented: number; whatsappConsented: number; suppressions: number };
};

export type Campaign = {
  id: string;
  name: string;
  channel: 'EMAIL' | 'WHATSAPP';
  status: CampaignSummary['status'];
  subject: string;
  previewText: string;
  fromName: string;
  fromLocalPart: string;
  fromDomain: string;
  replyTo: string;
  listId: string;
  listName: string;
  design: Design;
  scheduledAt: string | null;
  startedAt: string | null;
  sentAt: string | null;
  whatsappTemplate: string;
  whatsappVariables: Record<string, string>;
  lastError: string;
  counts: Record<string, number>;
};

export type Screen = { name: 'home' } | { name: 'editor'; id: string } | { name: 'report'; id: string } | { name: 'lists'; listId?: string } | { name: 'brand' } | { name: 'new' };

export const percent = (part: number | null | undefined, whole: number | null | undefined) => (whole ? `${Math.round(((part ?? 0) / whole) * 100)}%` : '-');
