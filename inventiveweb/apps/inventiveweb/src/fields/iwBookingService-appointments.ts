import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
export default defineField({
  "universalIdentifier": "a0ce425c-218f-5e6d-be23-955311b3ed9c",
  "objectUniversalIdentifier": "ec57b32a-bd86-52d6-8a14-8471bf453c73",
  "type": FieldType.RELATION,
  "name": "appointments",
  "label": "Appointments",
  "relationTargetObjectMetadataUniversalIdentifier": "2049812f-baf9-5981-a6a6-80cd7ff6081d",
  "relationTargetFieldMetadataUniversalIdentifier": "5a6ff57b-c9d0-59f7-82cd-d6c0ddb764f7",
  "universalSettings": {
    "relationType": RelationType.ONE_TO_MANY
  }
});
