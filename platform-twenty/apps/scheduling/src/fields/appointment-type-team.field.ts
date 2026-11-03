import { defineField, FieldType, OnDeleteAction, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.appointmentType.fields.team,
  objectUniversalIdentifier: IDS.appointmentType.object,
  type: FieldType.RELATION,
  name: 'team',
  label: "Team",
  icon: 'IconUsersGroup',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.schedulingTeam.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.schedulingTeam.fields.appointmentTypes,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'teamId',
  },
});
