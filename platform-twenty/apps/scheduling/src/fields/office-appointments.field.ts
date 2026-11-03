import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.office.fields.appointments,
  objectUniversalIdentifier: IDS.office.object,
  type: FieldType.RELATION,
  name: 'appointments',
  label: "Appointments",
  icon: 'IconCalendarCheck',
  relationTargetObjectMetadataUniversalIdentifier: IDS.appointment.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.appointment.fields.office,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
