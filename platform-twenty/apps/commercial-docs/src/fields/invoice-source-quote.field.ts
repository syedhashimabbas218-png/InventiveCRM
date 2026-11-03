import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
  } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.invoice.fields.sourceQuote,
  objectUniversalIdentifier: IDS.invoice.object,
  type: FieldType.RELATION,
  name: 'sourceQuote',
  label: 'From quote',
  icon: 'IconFileDescription',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.quote.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.quote.fields.invoices,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'sourceQuoteId',
  },
});
