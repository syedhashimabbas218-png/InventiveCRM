import {
  defineField,
  FieldType,
  RelationType,
  } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.productExtension.fields.quoteLines,
  objectUniversalIdentifier: IDS.product.object,
  type: FieldType.RELATION,
  name: 'quoteLines',
  label: 'Quote lines',
  icon: 'IconListDetails',
  relationTargetObjectMetadataUniversalIdentifier: IDS.quoteLine.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.quoteLine.fields.product,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
