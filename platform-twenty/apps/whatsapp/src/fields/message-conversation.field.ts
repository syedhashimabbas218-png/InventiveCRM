import { defineField, FieldType, OnDeleteAction, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.message.fields.conversation,
  objectUniversalIdentifier: IDS.message.object,
  type: FieldType.RELATION,
  name: 'conversation',
  label: 'Conversation',
  icon: 'IconBrandWhatsapp',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.conversation.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.conversation.fields.messages,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.CASCADE,
    joinColumnName: 'conversationId',
  },
});
