import { defineField, FieldType, OnDeleteAction, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.appointment.fields.appointmentType,
  objectUniversalIdentifier: IDS.appointment.object,
  type: FieldType.RELATION,
  name: 'appointmentType',
  label: "Appointment type",
  icon: 'IconCalendarEvent',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.appointmentType.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.appointmentType.fields.appointments,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'appointmentTypeId',
  },
});
