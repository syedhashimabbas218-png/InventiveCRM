import { defineField, FieldType, RelationType, OnDeleteAction } from 'twenty-sdk/define';
export default defineField({
  "universalIdentifier": "f5fe1eb4-7b3e-5844-88a6-c2d7f0bd9e5f",
  "objectUniversalIdentifier": "ec57b32a-bd86-52d6-8a14-8471bf453c73",
  "type": FieldType.RELATION,
  "name": "form",
  "label": "Form",
  "relationTargetObjectMetadataUniversalIdentifier": "fa0682a5-6e6c-5318-b629-ce39ab908d36",
  "relationTargetFieldMetadataUniversalIdentifier": "60f1d369-744e-5bbb-83e7-93f34b83b7ad",
  "universalSettings": {
    "relationType": RelationType.MANY_TO_ONE,
    "joinColumnName": "formId",
    "onDelete": OnDeleteAction.SET_NULL
  }
});
