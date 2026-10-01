import { defineField, FieldType, RelationType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';
export default defineField({
  "universalIdentifier": "e1c87b4f-81fa-5cc7-bd3d-2451afe98b44",
  "objectUniversalIdentifier": STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  "type": FieldType.RELATION,
  "name": "iwInvoices",
  "label": "Invoices",
  "relationTargetObjectMetadataUniversalIdentifier": "df0f21bd-4190-5f33-8a76-f09452268c51",
  "relationTargetFieldMetadataUniversalIdentifier": "3a7100a4-9e2d-5b3d-97cd-1588db23ec99",
  "universalSettings": {
    "relationType": RelationType.ONE_TO_MANY
  }
});
