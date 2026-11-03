import {
  defineField,
  FieldType,
  RelationType,
  } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.productExtension.fields.invoiceLines,
  objectUniversalIdentifier: IDS.product.object,
  type: FieldType.RELATION,
  name: 'invoiceLines',
  label: 'Invoice lines',
  icon: 'IconListDetails',
  relationTargetObjectMetadataUniversalIdentifier: IDS.invoiceLine.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.invoiceLine.fields.product,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
