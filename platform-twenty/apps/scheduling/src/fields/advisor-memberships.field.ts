import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.advisor.fields.memberships,
  objectUniversalIdentifier: IDS.advisor.object,
  type: FieldType.RELATION,
  name: 'memberships',
  label: "Teams",
  icon: 'IconUsersGroup',
  relationTargetObjectMetadataUniversalIdentifier: IDS.teamMembership.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.teamMembership.fields.advisor,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
