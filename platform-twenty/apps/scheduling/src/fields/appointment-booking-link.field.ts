import { defineField, FieldType, OnDeleteAction, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.appointment.fields.bookingLink,
  objectUniversalIdentifier: IDS.appointment.object,
  type: FieldType.RELATION,
  name: 'bookingLink',
  label: "Booking link",
  icon: 'IconLink',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.bookingLink.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.bookingLink.fields.appointments,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'bookingLinkId',
  },
});
