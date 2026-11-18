import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

const view = IDS.views.messages;
const field = IDS.message.fields;

export default defineView({
  universalIdentifier: view.view,
  name: 'All messages',
  objectUniversalIdentifier: IDS.message.object,
  icon: 'IconMessageCircle',
  position: 0,
  sorts: [{ universalIdentifier: view.sorts.occurredAt, fieldMetadataUniversalIdentifier: field.occurredAt, direction: 'DESC' }],
  fields: [
    { universalIdentifier: view.fields.name, fieldMetadataUniversalIdentifier: field.name, position: 0, isVisible: true, size: 280 },
    { universalIdentifier: view.fields.conversation, fieldMetadataUniversalIdentifier: field.conversation, position: 1, isVisible: true, size: 180 },
    { universalIdentifier: view.fields.direction, fieldMetadataUniversalIdentifier: field.direction, position: 2, isVisible: true, size: 150 },
    { universalIdentifier: view.fields.messageType, fieldMetadataUniversalIdentifier: field.messageType, position: 3, isVisible: true, size: 110 },
    { universalIdentifier: view.fields.status, fieldMetadataUniversalIdentifier: field.status, position: 4, isVisible: true, size: 110 },
    { universalIdentifier: view.fields.occurredAt, fieldMetadataUniversalIdentifier: field.occurredAt, position: 5, isVisible: true, size: 160 },
    { universalIdentifier: view.fields.person, fieldMetadataUniversalIdentifier: field.person, position: 6, isVisible: true, size: 160 },
    { universalIdentifier: view.fields.sentBy, fieldMetadataUniversalIdentifier: field.sentBy, position: 7, isVisible: true, size: 160 },
    { universalIdentifier: view.fields.error, fieldMetadataUniversalIdentifier: field.error, position: 8, isVisible: true, size: 260 },
  ],
});
