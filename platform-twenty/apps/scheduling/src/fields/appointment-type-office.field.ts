import { defineField, FieldType, OnDeleteAction, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.appointmentType.fields.office,
  objectUniversalIdentifier: IDS.appointmentType.object,
  type: FieldType.RELATION,
  name: 'office',
  label: "Office",
  icon: 'IconBuilding',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.office.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.office.fields.appointmentTypes,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'officeId',
  },
});
