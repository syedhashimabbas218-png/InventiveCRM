import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
export default defineField({
  "universalIdentifier": "3a3db0ae-9c00-5c21-b311-2d27bce6cff8",
  "objectUniversalIdentifier": "c774ad97-9749-56ed-bf78-733e0b8275b4",
  "type": FieldType.RELATION,
  "name": "appointments",
  "label": "Appointments",
  "relationTargetObjectMetadataUniversalIdentifier": "2049812f-baf9-5981-a6a6-80cd7ff6081d",
  "relationTargetFieldMetadataUniversalIdentifier": "b0538ca7-060f-5b70-9093-4d293d062700",
  "universalSettings": {
    "relationType": RelationType.ONE_TO_MANY
  }
});
