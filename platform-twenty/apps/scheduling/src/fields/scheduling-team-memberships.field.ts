import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.schedulingTeam.fields.memberships,
  objectUniversalIdentifier: IDS.schedulingTeam.object,
  type: FieldType.RELATION,
  name: 'memberships',
  label: "Members",
  icon: 'IconUsers',
  relationTargetObjectMetadataUniversalIdentifier: IDS.teamMembership.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.teamMembership.fields.team,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
