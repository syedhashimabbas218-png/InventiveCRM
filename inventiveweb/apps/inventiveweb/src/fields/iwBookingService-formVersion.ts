import { defineField, FieldType, RelationType, OnDeleteAction } from 'twenty-sdk/define';
export default defineField({
  "universalIdentifier": "66b982fd-d2f3-5b77-94eb-9be9a171758f",
  "objectUniversalIdentifier": "ec57b32a-bd86-52d6-8a14-8471bf453c73",
  "type": FieldType.RELATION,
  "name": "formVersion",
  "label": "Published form",
  "relationTargetObjectMetadataUniversalIdentifier": "c774ad97-9749-56ed-bf78-733e0b8275b4",
  "relationTargetFieldMetadataUniversalIdentifier": "f8ae1cee-5d4e-5de8-92c6-01f8c19a3b65",
  "universalSettings": {
    "relationType": RelationType.MANY_TO_ONE,
    "joinColumnName": "formVersionId",
    "onDelete": OnDeleteAction.SET_NULL
  }
});
