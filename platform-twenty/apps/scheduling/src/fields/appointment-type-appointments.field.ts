import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.appointmentType.fields.appointments,
  objectUniversalIdentifier: IDS.appointmentType.object,
  type: FieldType.RELATION,
  name: 'appointments',
  label: "Appointments",
  icon: 'IconCalendarCheck',
  relationTargetObjectMetadataUniversalIdentifier: IDS.appointment.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.appointment.fields.appointmentType,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
