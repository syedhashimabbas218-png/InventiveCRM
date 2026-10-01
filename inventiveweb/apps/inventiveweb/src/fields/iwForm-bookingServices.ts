import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
export default defineField({
  "universalIdentifier": "60f1d369-744e-5bbb-83e7-93f34b83b7ad",
  "objectUniversalIdentifier": "fa0682a5-6e6c-5318-b629-ce39ab908d36",
  "type": FieldType.RELATION,
  "name": "bookingServices",
  "label": "Booking services",
  "relationTargetObjectMetadataUniversalIdentifier": "ec57b32a-bd86-52d6-8a14-8471bf453c73",
  "relationTargetFieldMetadataUniversalIdentifier": "f5fe1eb4-7b3e-5844-88a6-c2d7f0bd9e5f",
  "universalSettings": {
    "relationType": RelationType.ONE_TO_MANY
  }
});
