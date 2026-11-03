import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.schedulingTeam.fields.appointmentTypes,
  objectUniversalIdentifier: IDS.schedulingTeam.object,
  type: FieldType.RELATION,
  name: 'appointmentTypes',
  label: "Appointment types",
  icon: 'IconCalendarEvent',
  relationTargetObjectMetadataUniversalIdentifier: IDS.appointmentType.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.appointmentType.fields.team,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
