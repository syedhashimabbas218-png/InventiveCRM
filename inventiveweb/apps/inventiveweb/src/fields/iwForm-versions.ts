import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
export default defineField({
  "universalIdentifier": "d9f69250-8c10-5149-8df4-4fe987c0625e",
  "objectUniversalIdentifier": "fa0682a5-6e6c-5318-b629-ce39ab908d36",
  "type": FieldType.RELATION,
  "name": "versions",
  "label": "Versions",
  "relationTargetObjectMetadataUniversalIdentifier": "c774ad97-9749-56ed-bf78-733e0b8275b4",
  "relationTargetFieldMetadataUniversalIdentifier": "33b84c43-58e6-5293-8b76-6593fa62f039",
  "universalSettings": {
    "relationType": RelationType.ONE_TO_MANY
  }
});
