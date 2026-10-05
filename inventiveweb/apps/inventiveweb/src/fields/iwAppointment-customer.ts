import { defineField, FieldType, RelationType, OnDeleteAction, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';
export default defineField({
  "universalIdentifier": "9485d557-0696-52c6-b467-6de28e766b1e",
  "objectUniversalIdentifier": "2049812f-baf9-5981-a6a6-80cd7ff6081d",
  "type": FieldType.RELATION,
  "name": "customer",
  "label": "Customer",
  "relationTargetObjectMetadataUniversalIdentifier": STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  "relationTargetFieldMetadataUniversalIdentifier": "1538c4ea-e4d4-522c-a25f-aacf1dcb37b7",
  "universalSettings": {
    "relationType": RelationType.MANY_TO_ONE,
    "joinColumnName": "customerId",
    "onDelete": OnDeleteAction.SET_NULL
  }
});
