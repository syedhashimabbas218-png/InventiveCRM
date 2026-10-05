import { defineField, FieldType, RelationType, OnDeleteAction } from 'twenty-sdk/define';
export default defineField({
  "universalIdentifier": "b0538ca7-060f-5b70-9093-4d293d062700",
  "objectUniversalIdentifier": "2049812f-baf9-5981-a6a6-80cd7ff6081d",
  "type": FieldType.RELATION,
  "name": "formVersion",
  "label": "Form version",
  "relationTargetObjectMetadataUniversalIdentifier": "c774ad97-9749-56ed-bf78-733e0b8275b4",
  "relationTargetFieldMetadataUniversalIdentifier": "3a3db0ae-9c00-5c21-b311-2d27bce6cff8",
  "universalSettings": {
    "relationType": RelationType.MANY_TO_ONE,
    "joinColumnName": "formVersionId",
    "onDelete": OnDeleteAction.SET_NULL
  }
});
