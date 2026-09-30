import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
export default defineField({
  "universalIdentifier": "f8ae1cee-5d4e-5de8-92c6-01f8c19a3b65",
  "objectUniversalIdentifier": "c774ad97-9749-56ed-bf78-733e0b8275b4",
  "type": FieldType.RELATION,
  "name": "bookingServices",
  "label": "Booking services",
  "relationTargetObjectMetadataUniversalIdentifier": "ec57b32a-bd86-52d6-8a14-8471bf453c73",
  "relationTargetFieldMetadataUniversalIdentifier": "66b982fd-d2f3-5b77-94eb-9be9a171758f",
  "universalSettings": {
    "relationType": RelationType.ONE_TO_MANY
  }
});
