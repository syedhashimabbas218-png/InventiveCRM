import { defineField, FieldType, RelationType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.workspaceMemberExtension.fields.sentWhatsappMessages,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.workspaceMember.universalIdentifier,
  type: FieldType.RELATION,
  name: 'sentWhatsappMessages',
  label: 'Sent WhatsApp messages',
  icon: 'IconMessageCircle',
  relationTargetObjectMetadataUniversalIdentifier: IDS.message.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.message.fields.sentBy,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
