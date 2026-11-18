import { defineField, FieldType, RelationType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.workspaceMemberExtension.fields.assignedWhatsappConversations,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.workspaceMember.universalIdentifier,
  type: FieldType.RELATION,
  name: 'assignedWhatsappConversations',
  label: 'Assigned WhatsApp conversations',
  icon: 'IconBrandWhatsapp',
  relationTargetObjectMetadataUniversalIdentifier: IDS.conversation.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.conversation.fields.assignee,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
