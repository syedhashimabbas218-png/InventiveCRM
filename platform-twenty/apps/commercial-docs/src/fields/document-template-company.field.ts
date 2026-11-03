import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.documentTemplate.fields.company,
  objectUniversalIdentifier: IDS.documentTemplate.object,
  type: FieldType.RELATION,
  name: 'company',
  label: 'Only for client',
  icon: 'IconBuildingSkyscraper',
  description: 'Leave empty to use the template for every client.',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.company.universalIdentifier,
  relationTargetFieldMetadataUniversalIdentifier: IDS.companyExtension.fields.documentTemplates,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'companyId',
  },
});
