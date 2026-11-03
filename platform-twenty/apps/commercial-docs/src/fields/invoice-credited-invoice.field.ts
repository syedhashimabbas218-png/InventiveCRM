import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
  } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.invoice.fields.creditedInvoice,
  objectUniversalIdentifier: IDS.invoice.object,
  type: FieldType.RELATION,
  name: 'creditedInvoice',
  label: 'Credited invoice',
  icon: 'IconFileMinus',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.invoice.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.invoice.fields.creditNotes,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'creditedInvoiceId',
  },
});
