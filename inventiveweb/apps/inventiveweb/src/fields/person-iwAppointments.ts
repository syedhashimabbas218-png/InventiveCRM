import { defineField, FieldType, RelationType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';
export default defineField({
  "universalIdentifier": "1538c4ea-e4d4-522c-a25f-aacf1dcb37b7",
  "objectUniversalIdentifier": STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  "type": FieldType.RELATION,
  "name": "iwAppointments",
  "label": "Appointments",
  "relationTargetObjectMetadataUniversalIdentifier": "2049812f-baf9-5981-a6a6-80cd7ff6081d",
  "relationTargetFieldMetadataUniversalIdentifier": "9485d557-0696-52c6-b467-6de28e766b1e",
  "universalSettings": {
    "relationType": RelationType.ONE_TO_MANY
  }
});
