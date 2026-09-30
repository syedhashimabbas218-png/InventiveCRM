import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
export default defineField({
  "universalIdentifier": "46ddfcbf-368c-5a02-8e26-a07af4182b30",
  "objectUniversalIdentifier": "c774ad97-9749-56ed-bf78-733e0b8275b4",
  "type": FieldType.RELATION,
  "name": "invoices",
  "label": "Invoices",
  "relationTargetObjectMetadataUniversalIdentifier": "df0f21bd-4190-5f33-8a76-f09452268c51",
  "relationTargetFieldMetadataUniversalIdentifier": "a2a24710-fb46-5069-904c-c66286034b83",
  "universalSettings": {
    "relationType": RelationType.ONE_TO_MANY
  }
});
