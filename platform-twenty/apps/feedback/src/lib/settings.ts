import { type Channel } from 'src/constants/enums';
import { gql, nodes } from 'src/lib/api';

export type FeedbackSettings = {
  id: string;
  businessName: string;
  enabled: boolean;
  afterAppointments: boolean;
  afterPaidInvoices: boolean;
  delayHours: number | null;
  cooldownDays: number | null;
  expiryDays: number | null;
  channel: Channel;
  question: string;
  googleReviewUrl: string;
  promoterScore: number | null;
  alertBelowScore: number | null;
  alertEmails: string;
  lastScannedAt: string | null;
};

const FIELDS = 'id businessName enabled afterAppointments afterPaidInvoices delayHours cooldownDays expiryDays channel question googleReviewUrl promoterScore alertBelowScore alertEmails lastScannedAt';

export const loadSettings = async (): Promise<FeedbackSettings | null> =>
  nodes(
    (
      await gql<{ feedbackSettingsRecords: { edges: { node: FeedbackSettings }[] } }>(
        `{ feedbackSettingsRecords(orderBy: [{ createdAt: AscNullsLast }], first: 1) { edges { node { ${FIELDS} } } } }`,
      )
    ).feedbackSettingsRecords,
  )[0] ?? null;

// Created switched off, so nothing is sent until someone has read and saved the settings.
export const ensureSettings = async () => {
  const existing = await loadSettings();
  if (existing) return existing;
  await gql(`mutation($data: FeedbackSettingsCreateInput!) { createFeedbackSettings(data: $data) { id } }`, { data: { name: 'Feedback settings', enabled: false } });
  return (await loadSettings()) as FeedbackSettings;
};

export const updateSettings = (id: string, data: Record<string, unknown>) =>
  gql(`mutation($id: UUID!, $data: FeedbackSettingsUpdateInput!) { updateFeedbackSettings(id: $id, data: $data) { id } }`, { id, data });
