import { defineField, FieldType, RelationType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.personExtension.fields.whatsappConversations,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.RELATION,
  name: 'whatsappConversations',
  label: 'WhatsApp conversations',
  icon: 'IconBrandWhatsapp',
  relationTargetObjectMetadataUniversalIdentifier: IDS.conversation.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.conversation.fields.person,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
