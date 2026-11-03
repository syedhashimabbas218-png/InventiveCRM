import { defineField, FieldType, OnDeleteAction, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.bookingLink.fields.appointmentType,
  objectUniversalIdentifier: IDS.bookingLink.object,
  type: FieldType.RELATION,
  name: 'appointmentType',
  label: "Appointment type",
  icon: 'IconCalendarEvent',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.appointmentType.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.appointmentType.fields.bookingLinks,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.CASCADE,
    joinColumnName: 'appointmentTypeId',
  },
});
