import { defineField, FieldType, RelationType, OnDeleteAction } from 'twenty-sdk/define';
export default defineField({
  "universalIdentifier": "776e9715-b902-500b-ad66-3350f69f41a9",
  "objectUniversalIdentifier": "df0f21bd-4190-5f33-8a76-f09452268c51",
  "type": FieldType.RELATION,
  "name": "quote",
  "label": "Quote",
  "relationTargetObjectMetadataUniversalIdentifier": "43976081-def7-5c5c-8b96-89456688637e",
  "relationTargetFieldMetadataUniversalIdentifier": "bdf9d4ed-ed9b-5861-8435-a2c31ee0d30c",
  "universalSettings": {
    "relationType": RelationType.MANY_TO_ONE,
    "joinColumnName": "quoteId",
    "onDelete": OnDeleteAction.SET_NULL
  }
});
