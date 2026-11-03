import {
  defineField,
  FieldType,
  RelationType,
  } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.quote.fields.invoices,
  objectUniversalIdentifier: IDS.quote.object,
  type: FieldType.RELATION,
  name: 'invoices',
  label: 'Invoices',
  icon: 'IconFileInvoice',
  relationTargetObjectMetadataUniversalIdentifier: IDS.invoice.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.invoice.fields.sourceQuote,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
