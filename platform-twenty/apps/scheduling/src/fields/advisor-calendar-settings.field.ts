import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.advisor.fields.calendarSettings,
  objectUniversalIdentifier: IDS.advisor.object,
  type: FieldType.RELATION,
  name: 'calendarSettings',
  label: "Calendar connections",
  icon: 'IconCalendarShare',
  relationTargetObjectMetadataUniversalIdentifier: IDS.calendarSetting.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.calendarSetting.fields.advisor,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
