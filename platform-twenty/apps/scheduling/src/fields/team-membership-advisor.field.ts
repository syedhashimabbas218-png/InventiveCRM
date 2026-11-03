import { defineField, FieldType, OnDeleteAction, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.teamMembership.fields.advisor,
  objectUniversalIdentifier: IDS.teamMembership.object,
  type: FieldType.RELATION,
  name: 'advisor',
  label: "Advisor",
  icon: 'IconUserCircle',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.advisor.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.advisor.fields.memberships,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.CASCADE,
    joinColumnName: 'advisorId',
  },
});
