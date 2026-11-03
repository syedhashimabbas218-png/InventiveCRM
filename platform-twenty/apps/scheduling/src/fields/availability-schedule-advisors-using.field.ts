import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.availabilitySchedule.fields.advisorsUsing,
  objectUniversalIdentifier: IDS.availabilitySchedule.object,
  type: FieldType.RELATION,
  name: 'advisorsUsing',
  label: "Used by advisors",
  icon: 'IconUserCircle',
  relationTargetObjectMetadataUniversalIdentifier: IDS.advisor.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.advisor.fields.schedule,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
