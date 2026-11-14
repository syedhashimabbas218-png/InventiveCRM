import { defineField, FieldType, RelationType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.personExtension.fields.listMemberships,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.RELATION,
  name: 'mailingListMemberships',
  label: 'Mailing lists',
  icon: 'IconList',
  relationTargetObjectMetadataUniversalIdentifier: IDS.listMember.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.listMember.fields.person,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
