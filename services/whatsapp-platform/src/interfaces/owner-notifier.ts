export type OwnerAlert = {
  tenantId: string;
  conversationId?: string;
  kind: 'emergency' | 'handoff' | 'limit_reached' | 'send_failed' | 'send_outcome_unknown';
  message: string;
};

export type OwnerNotifier = {
  alert: (alert: OwnerAlert) => Promise<void>;
};
