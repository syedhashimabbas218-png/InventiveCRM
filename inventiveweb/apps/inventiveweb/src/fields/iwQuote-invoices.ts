import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
export default defineField({
  "universalIdentifier": "bdf9d4ed-ed9b-5861-8435-a2c31ee0d30c",
  "objectUniversalIdentifier": "43976081-def7-5c5c-8b96-89456688637e",
  "type": FieldType.RELATION,
  "name": "invoices",
  "label": "Invoices",
  "relationTargetObjectMetadataUniversalIdentifier": "df0f21bd-4190-5f33-8a76-f09452268c51",
  "relationTargetFieldMetadataUniversalIdentifier": "776e9715-b902-500b-ad66-3350f69f41a9",
  "universalSettings": {
    "relationType": RelationType.ONE_TO_MANY
  }
});
