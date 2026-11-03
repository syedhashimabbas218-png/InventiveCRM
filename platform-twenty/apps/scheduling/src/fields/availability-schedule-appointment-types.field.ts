import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.availabilitySchedule.fields.appointmentTypes,
  objectUniversalIdentifier: IDS.availabilitySchedule.object,
  type: FieldType.RELATION,
  name: 'appointmentTypes',
  label: "Appointment types",
  icon: 'IconCalendarEvent',
  relationTargetObjectMetadataUniversalIdentifier: IDS.appointmentType.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.appointmentType.fields.schedule,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
