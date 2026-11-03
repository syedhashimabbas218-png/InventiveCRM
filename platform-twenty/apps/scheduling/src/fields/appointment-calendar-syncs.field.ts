import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.appointment.fields.calendarSyncs,
  objectUniversalIdentifier: IDS.appointment.object,
  type: FieldType.RELATION,
  name: 'calendarSyncs',
  label: "Calendar syncs",
  icon: 'IconRefresh',
  relationTargetObjectMetadataUniversalIdentifier: IDS.calendarSync.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.calendarSync.fields.appointment,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
