import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

const view = IDS.views.allConversations;
const field = IDS.conversation.fields;

export default defineView({
  universalIdentifier: view.view,
  name: 'All conversations',
  objectUniversalIdentifier: IDS.conversation.object,
  icon: 'IconMessages',
  position: 1,
  sorts: [{ universalIdentifier: view.sorts.lastMessageAt, fieldMetadataUniversalIdentifier: field.lastMessageAt, direction: 'DESC' }],
  fields: [
    { universalIdentifier: view.fields.name, fieldMetadataUniversalIdentifier: field.name, position: 0, isVisible: true, size: 200 },
    { universalIdentifier: view.fields.status, fieldMetadataUniversalIdentifier: field.status, position: 1, isVisible: true, size: 110 },
    { universalIdentifier: view.fields.handling, fieldMetadataUniversalIdentifier: field.handling, position: 2, isVisible: true, size: 140 },
    { universalIdentifier: view.fields.assignee, fieldMetadataUniversalIdentifier: field.assignee, position: 3, isVisible: true, size: 160 },
    { universalIdentifier: view.fields.lastMessageAt, fieldMetadataUniversalIdentifier: field.lastMessageAt, position: 4, isVisible: true, size: 160 },
    { universalIdentifier: view.fields.person, fieldMetadataUniversalIdentifier: field.person, position: 5, isVisible: true, size: 160 },
    { universalIdentifier: view.fields.company, fieldMetadataUniversalIdentifier: field.company, position: 6, isVisible: true, size: 160 },
    { universalIdentifier: view.fields.customerPhone, fieldMetadataUniversalIdentifier: field.customerPhone, position: 7, isVisible: true, size: 150 },
    { universalIdentifier: view.fields.optedOut, fieldMetadataUniversalIdentifier: field.optedOut, position: 8, isVisible: true, size: 110 },
  ],
});
