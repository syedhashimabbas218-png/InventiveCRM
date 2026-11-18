import { defineField, FieldType, RelationType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.personExtension.fields.whatsappMessages,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.RELATION,
  name: 'whatsappMessages',
  label: 'WhatsApp messages',
  icon: 'IconMessageCircle',
  relationTargetObjectMetadataUniversalIdentifier: IDS.message.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.message.fields.person,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
