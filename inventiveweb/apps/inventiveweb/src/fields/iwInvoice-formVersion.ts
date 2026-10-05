import { defineField, FieldType, RelationType, OnDeleteAction } from 'twenty-sdk/define';
export default defineField({
  "universalIdentifier": "a2a24710-fb46-5069-904c-c66286034b83",
  "objectUniversalIdentifier": "df0f21bd-4190-5f33-8a76-f09452268c51",
  "type": FieldType.RELATION,
  "name": "formVersion",
  "label": "Form version",
  "relationTargetObjectMetadataUniversalIdentifier": "c774ad97-9749-56ed-bf78-733e0b8275b4",
  "relationTargetFieldMetadataUniversalIdentifier": "46ddfcbf-368c-5a02-8e26-a07af4182b30",
  "universalSettings": {
    "relationType": RelationType.MANY_TO_ONE,
    "joinColumnName": "formVersionId",
    "onDelete": OnDeleteAction.SET_NULL
  }
});
