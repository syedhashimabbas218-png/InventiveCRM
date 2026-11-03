import { defineField, FieldType, OnDeleteAction, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.calendarSync.fields.appointment,
  objectUniversalIdentifier: IDS.calendarSync.object,
  type: FieldType.RELATION,
  name: 'appointment',
  label: "Appointment",
  icon: 'IconCalendarCheck',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.appointment.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.appointment.fields.calendarSyncs,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.CASCADE,
    joinColumnName: 'appointmentId',
  },
});
