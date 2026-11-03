import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.companyExtension.fields.documentTemplates,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.company.universalIdentifier,
  type: FieldType.RELATION,
  name: 'documentTemplates',
  label: 'Document templates',
  icon: 'IconTemplate',
  relationTargetObjectMetadataUniversalIdentifier: IDS.documentTemplate.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.documentTemplate.fields.company,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
