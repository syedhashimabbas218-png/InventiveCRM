import { defineField, FieldType, OnDeleteAction, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.teamMembership.fields.team,
  objectUniversalIdentifier: IDS.teamMembership.object,
  type: FieldType.RELATION,
  name: 'team',
  label: "Team",
  icon: 'IconUsersGroup',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.schedulingTeam.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.schedulingTeam.fields.memberships,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.CASCADE,
    joinColumnName: 'teamId',
  },
});
