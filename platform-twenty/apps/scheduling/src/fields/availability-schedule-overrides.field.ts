import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.availabilitySchedule.fields.overrides,
  objectUniversalIdentifier: IDS.availabilitySchedule.object,
  type: FieldType.RELATION,
  name: 'overrides',
  label: "Time off and special hours",
  icon: 'IconCalendarOff',
  relationTargetObjectMetadataUniversalIdentifier: IDS.availabilityOverride.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.availabilityOverride.fields.schedule,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
