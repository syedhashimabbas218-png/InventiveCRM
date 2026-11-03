import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.office.fields.advisors,
  objectUniversalIdentifier: IDS.office.object,
  type: FieldType.RELATION,
  name: 'advisors',
  label: "Advisors",
  icon: 'IconUserCircle',
  relationTargetObjectMetadataUniversalIdentifier: IDS.advisor.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.advisor.fields.office,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
