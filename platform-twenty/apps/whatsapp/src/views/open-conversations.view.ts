import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

const view = IDS.views.openConversations;
const field = IDS.conversation.fields;

export default defineView({
  universalIdentifier: view.view,
  name: 'Open conversations',
  objectUniversalIdentifier: IDS.conversation.object,
  icon: 'IconBrandWhatsapp',
  position: 0,
  filters: [{ universalIdentifier: view.filters.status, fieldMetadataUniversalIdentifier: field.status, operand: 'IS', value: ['OPEN'] }],
  sorts: [{ universalIdentifier: view.sorts.lastMessageAt, fieldMetadataUniversalIdentifier: field.lastMessageAt, direction: 'DESC' }],
  fields: [
    { universalIdentifier: view.fields.name, fieldMetadataUniversalIdentifier: field.name, position: 0, isVisible: true, size: 200 },
    { universalIdentifier: view.fields.unreadCount, fieldMetadataUniversalIdentifier: field.unreadCount, position: 1, isVisible: true, size: 90 },
    { universalIdentifier: view.fields.lastMessagePreview, fieldMetadataUniversalIdentifier: field.lastMessagePreview, position: 2, isVisible: true, size: 280 },
    { universalIdentifier: view.fields.lastMessageAt, fieldMetadataUniversalIdentifier: field.lastMessageAt, position: 3, isVisible: true, size: 160 },
    { universalIdentifier: view.fields.assignee, fieldMetadataUniversalIdentifier: field.assignee, position: 4, isVisible: true, size: 160 },
    { universalIdentifier: view.fields.person, fieldMetadataUniversalIdentifier: field.person, position: 5, isVisible: true, size: 160 },
    { universalIdentifier: view.fields.company, fieldMetadataUniversalIdentifier: field.company, position: 6, isVisible: true, size: 160 },
    { universalIdentifier: view.fields.customerPhone, fieldMetadataUniversalIdentifier: field.customerPhone, position: 7, isVisible: true, size: 150 },
    { universalIdentifier: view.fields.windowExpiresAt, fieldMetadataUniversalIdentifier: field.windowExpiresAt, position: 8, isVisible: true, size: 160 },
  ],
});
