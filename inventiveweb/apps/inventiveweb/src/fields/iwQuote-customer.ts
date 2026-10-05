import { defineField, FieldType, RelationType, OnDeleteAction, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';
export default defineField({
  "universalIdentifier": "f0d35e87-1f4c-5b0d-b5ba-7997cc9216ac",
  "objectUniversalIdentifier": "43976081-def7-5c5c-8b96-89456688637e",
  "type": FieldType.RELATION,
  "name": "customer",
  "label": "Customer",
  "relationTargetObjectMetadataUniversalIdentifier": STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  "relationTargetFieldMetadataUniversalIdentifier": "0704527c-9036-5034-bd4c-5f6810cb3c18",
  "universalSettings": {
    "relationType": RelationType.MANY_TO_ONE,
    "joinColumnName": "customerId",
    "onDelete": OnDeleteAction.SET_NULL
  }
});
