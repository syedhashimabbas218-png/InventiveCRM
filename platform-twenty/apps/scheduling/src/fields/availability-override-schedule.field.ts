import { defineField, FieldType, OnDeleteAction, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.availabilityOverride.fields.schedule,
  objectUniversalIdentifier: IDS.availabilityOverride.object,
  type: FieldType.RELATION,
  name: 'schedule',
  label: "Schedule",
  icon: 'IconCalendarTime',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.availabilitySchedule.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.availabilitySchedule.fields.overrides,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.CASCADE,
    joinColumnName: 'scheduleId',
  },
});
