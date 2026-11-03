import { type DatabaseEventPayload, defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { checkTemplate } from 'src/lib/document-layout';

type TemplateEvent = {
  recordId: string;
  properties: {
    before?: { checkedAt?: string | null };
    after?: { checkedAt?: string | null };
  };
};

const handler = async (payload: DatabaseEventPayload<TemplateEvent>) => {
  // Every check writes checkedAt, so an update that changed it is the check's own write, not a user's.
  if (payload.properties.before?.checkedAt !== payload.properties.after?.checkedAt) return { skipped: true };
  return checkTemplate(payload.recordId);
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.checkDocumentTemplate,
  name: 'check-document-template',
  description: 'Reads a changed document template (OCR for scans), classifies it with keyword rules and checks it against UK requirements.',
  timeoutSeconds: 120,
  databaseEventTriggerSettings: { eventName: 'documentTemplate.updated', updatedFields: ['file', 'documentType', 'vatScheme'] },
  handler,
});
