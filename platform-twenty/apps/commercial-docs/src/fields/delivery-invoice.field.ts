import { defineField, FieldType, OnDeleteAction, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.delivery.fields.invoice,
  objectUniversalIdentifier: IDS.delivery.object,
  type: FieldType.RELATION,
  name: 'invoice',
  label: 'Invoice',
  icon: 'IconFileInvoice',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.invoice.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.invoice.fields.deliveries,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.CASCADE,
    joinColumnName: 'invoiceId',
  },
});
