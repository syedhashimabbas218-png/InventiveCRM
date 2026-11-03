import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
  } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.invoiceLine.fields.invoice,
  objectUniversalIdentifier: IDS.invoiceLine.object,
  type: FieldType.RELATION,
  name: 'invoice',
  label: 'Invoice',
  icon: 'IconFileInvoice',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.invoice.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.invoice.fields.lines,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.CASCADE,
    joinColumnName: 'invoiceId',
  },
});
