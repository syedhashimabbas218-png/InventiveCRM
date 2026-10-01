import { defineField, FieldType, RelationType, OnDeleteAction } from 'twenty-sdk/define';
export default defineField({
  "universalIdentifier": "33b84c43-58e6-5293-8b76-6593fa62f039",
  "objectUniversalIdentifier": "c774ad97-9749-56ed-bf78-733e0b8275b4",
  "type": FieldType.RELATION,
  "name": "form",
  "label": "Form",
  "relationTargetObjectMetadataUniversalIdentifier": "fa0682a5-6e6c-5318-b629-ce39ab908d36",
  "relationTargetFieldMetadataUniversalIdentifier": "d9f69250-8c10-5149-8df4-4fe987c0625e",
  "universalSettings": {
    "relationType": RelationType.MANY_TO_ONE,
    "joinColumnName": "formId",
    "onDelete": OnDeleteAction.SET_NULL
  }
});
