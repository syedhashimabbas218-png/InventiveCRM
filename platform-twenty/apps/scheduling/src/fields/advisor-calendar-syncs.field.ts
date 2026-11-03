import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.advisor.fields.calendarSyncs,
  objectUniversalIdentifier: IDS.advisor.object,
  type: FieldType.RELATION,
  name: 'calendarSyncs',
  label: "Calendar syncs",
  icon: 'IconRefresh',
  relationTargetObjectMetadataUniversalIdentifier: IDS.calendarSync.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.calendarSync.fields.advisor,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
