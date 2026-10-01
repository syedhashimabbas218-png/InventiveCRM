import { defineField, FieldType, RelationType, OnDeleteAction } from 'twenty-sdk/define';
export default defineField({
  "universalIdentifier": "5a8c0774-3071-51c8-aa57-9257b726af6f",
  "objectUniversalIdentifier": "43976081-def7-5c5c-8b96-89456688637e",
  "type": FieldType.RELATION,
  "name": "formVersion",
  "label": "Form version",
  "relationTargetObjectMetadataUniversalIdentifier": "c774ad97-9749-56ed-bf78-733e0b8275b4",
  "relationTargetFieldMetadataUniversalIdentifier": "bc620bb5-b01f-5940-b8cc-9f2a84cd0ef3",
  "universalSettings": {
    "relationType": RelationType.MANY_TO_ONE,
    "joinColumnName": "formVersionId",
    "onDelete": OnDeleteAction.SET_NULL
  }
});
