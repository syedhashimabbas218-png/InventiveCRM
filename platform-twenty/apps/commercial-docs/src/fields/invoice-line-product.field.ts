import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
  } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.invoiceLine.fields.product,
  objectUniversalIdentifier: IDS.invoiceLine.object,
  type: FieldType.RELATION,
  name: 'product',
  label: 'Product',
  icon: 'IconPackage',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.product.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.productExtension.fields.invoiceLines,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'productId',
  },
});
