import { defineField, FieldType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.companyExtension.fields.vatNumber,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.company.universalIdentifier,
  type: FieldType.TEXT,
  name: 'vatNumber',
  label: 'VAT number',
  icon: 'IconReceiptTax',
  description: "Client's UK VAT registration number, needed for reverse charge invoices.",
});
