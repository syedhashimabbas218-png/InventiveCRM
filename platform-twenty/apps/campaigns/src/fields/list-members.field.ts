import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.list.fields.members,
  objectUniversalIdentifier: IDS.list.object,
  type: FieldType.RELATION,
  name: 'members',
  label: 'Contacts',
  icon: 'IconUsers',
  relationTargetObjectMetadataUniversalIdentifier: IDS.listMember.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.listMember.fields.list,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
