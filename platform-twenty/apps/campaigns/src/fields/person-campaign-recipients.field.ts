import { defineField, FieldType, RelationType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.personExtension.fields.campaignRecipients,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.RELATION,
  name: 'campaignRecipients',
  label: 'Campaign history',
  icon: 'IconSpeakerphone',
  relationTargetObjectMetadataUniversalIdentifier: IDS.recipient.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.recipient.fields.person,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
