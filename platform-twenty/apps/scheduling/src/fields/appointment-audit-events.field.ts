import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.appointment.fields.auditEvents,
  objectUniversalIdentifier: IDS.appointment.object,
  type: FieldType.RELATION,
  name: 'auditEvents',
  label: "History",
  icon: 'IconHistory',
  relationTargetObjectMetadataUniversalIdentifier: IDS.schedulingAuditEvent.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.schedulingAuditEvent.fields.appointment,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
