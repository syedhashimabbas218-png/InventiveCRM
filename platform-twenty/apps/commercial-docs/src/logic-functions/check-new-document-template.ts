import { type DatabaseEventPayload, defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { runAsApplication } from 'src/lib/api';
import { checkTemplate } from 'src/lib/document-layout';

const handler = async (payload: DatabaseEventPayload<{ recordId: string }>) => checkTemplate(payload.recordId);

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.checkNewDocumentTemplate,
  name: 'check-new-document-template',
  description: 'Checks a document template when it is added.',
  timeoutSeconds: 120,
  databaseEventTriggerSettings: { eventName: 'documentTemplate.created' },
  handler: runAsApplication(handler),
});
