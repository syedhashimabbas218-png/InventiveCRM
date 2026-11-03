import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
  } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.companyExtension.fields.invoices,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.company.universalIdentifier,
  type: FieldType.RELATION,
  name: 'invoices',
  label: 'Invoices',
  icon: 'IconFileInvoice',
  relationTargetObjectMetadataUniversalIdentifier: IDS.invoice.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.invoice.fields.company,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
