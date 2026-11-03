import { defineField, FieldType, OnDeleteAction, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.appointmentParticipant.fields.advisor,
  objectUniversalIdentifier: IDS.appointmentParticipant.object,
  type: FieldType.RELATION,
  name: 'advisor',
  label: "Advisor",
  icon: 'IconUserCircle',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.advisor.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.advisor.fields.participations,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.CASCADE,
    joinColumnName: 'advisorId',
  },
});
