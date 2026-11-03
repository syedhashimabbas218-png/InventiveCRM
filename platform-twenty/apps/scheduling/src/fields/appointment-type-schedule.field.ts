import { defineField, FieldType, OnDeleteAction, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.appointmentType.fields.schedule,
  objectUniversalIdentifier: IDS.appointmentType.object,
  type: FieldType.RELATION,
  name: 'schedule',
  label: "Schedule override",
  icon: 'IconCalendarTime',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.availabilitySchedule.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.availabilitySchedule.fields.appointmentTypes,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'scheduleId',
  },
});
