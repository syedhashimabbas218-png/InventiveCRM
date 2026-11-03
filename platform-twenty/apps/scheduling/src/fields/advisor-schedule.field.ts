import { defineField, FieldType, OnDeleteAction, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.advisor.fields.schedule,
  objectUniversalIdentifier: IDS.advisor.object,
  type: FieldType.RELATION,
  name: 'schedule',
  label: "Schedule",
  icon: 'IconCalendarTime',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.availabilitySchedule.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.availabilitySchedule.fields.advisorsUsing,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'scheduleId',
  },
});
