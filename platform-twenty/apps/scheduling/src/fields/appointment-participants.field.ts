import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.appointment.fields.participants,
  objectUniversalIdentifier: IDS.appointment.object,
  type: FieldType.RELATION,
  name: 'participants',
  label: "Advisors taking part",
  icon: 'IconUsers',
  relationTargetObjectMetadataUniversalIdentifier: IDS.appointmentParticipant.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.appointmentParticipant.fields.appointment,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
