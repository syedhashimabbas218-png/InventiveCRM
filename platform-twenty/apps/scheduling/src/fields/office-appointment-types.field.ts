import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.office.fields.appointmentTypes,
  objectUniversalIdentifier: IDS.office.object,
  type: FieldType.RELATION,
  name: 'appointmentTypes',
  label: "Appointment types",
  icon: 'IconCalendarEvent',
  relationTargetObjectMetadataUniversalIdentifier: IDS.appointmentType.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.appointmentType.fields.office,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
