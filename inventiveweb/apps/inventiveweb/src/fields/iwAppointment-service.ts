import { defineField, FieldType, RelationType, OnDeleteAction } from 'twenty-sdk/define';
export default defineField({
  "universalIdentifier": "5a6ff57b-c9d0-59f7-82cd-d6c0ddb764f7",
  "objectUniversalIdentifier": "2049812f-baf9-5981-a6a6-80cd7ff6081d",
  "type": FieldType.RELATION,
  "name": "service",
  "label": "Service",
  "relationTargetObjectMetadataUniversalIdentifier": "ec57b32a-bd86-52d6-8a14-8471bf453c73",
  "relationTargetFieldMetadataUniversalIdentifier": "a0ce425c-218f-5e6d-be23-955311b3ed9c",
  "universalSettings": {
    "relationType": RelationType.MANY_TO_ONE,
    "joinColumnName": "serviceId",
    "onDelete": OnDeleteAction.SET_NULL
  }
});
