import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.advisor.fields.schedules,
  objectUniversalIdentifier: IDS.advisor.object,
  type: FieldType.RELATION,
  name: 'schedules',
  label: "Schedules",
  icon: 'IconCalendarTime',
  relationTargetObjectMetadataUniversalIdentifier: IDS.availabilitySchedule.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.availabilitySchedule.fields.owner,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
