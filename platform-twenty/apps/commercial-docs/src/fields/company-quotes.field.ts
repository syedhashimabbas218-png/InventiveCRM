import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
  } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.companyExtension.fields.quotes,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.company.universalIdentifier,
  type: FieldType.RELATION,
  name: 'quotes',
  label: 'Quotes',
  icon: 'IconFileDescription',
  relationTargetObjectMetadataUniversalIdentifier: IDS.quote.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.quote.fields.company,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
