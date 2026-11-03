import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.advisor.fields.participations,
  objectUniversalIdentifier: IDS.advisor.object,
  type: FieldType.RELATION,
  name: 'participations',
  label: "Appointments taking part in",
  icon: 'IconUsers',
  relationTargetObjectMetadataUniversalIdentifier: IDS.appointmentParticipant.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.appointmentParticipant.fields.advisor,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
