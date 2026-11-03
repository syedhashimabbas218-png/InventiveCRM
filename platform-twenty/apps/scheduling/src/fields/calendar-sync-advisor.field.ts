import { defineField, FieldType, OnDeleteAction, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.calendarSync.fields.advisor,
  objectUniversalIdentifier: IDS.calendarSync.object,
  type: FieldType.RELATION,
  name: 'advisor',
  label: "Advisor",
  icon: 'IconUserCircle',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.advisor.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.advisor.fields.calendarSyncs,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'advisorId',
  },
});
