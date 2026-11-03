import { defineField, FieldType, OnDeleteAction, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.slotReservation.fields.appointment,
  objectUniversalIdentifier: IDS.slotReservation.object,
  type: FieldType.RELATION,
  name: 'appointment',
  label: "Appointment",
  icon: 'IconCalendarCheck',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.appointment.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.appointment.fields.reservations,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.CASCADE,
    joinColumnName: 'appointmentId',
  },
});
