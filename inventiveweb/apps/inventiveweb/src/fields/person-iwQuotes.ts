import { defineField, FieldType, RelationType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';
export default defineField({
  "universalIdentifier": "0704527c-9036-5034-bd4c-5f6810cb3c18",
  "objectUniversalIdentifier": STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  "type": FieldType.RELATION,
  "name": "iwQuotes",
  "label": "Quotes",
  "relationTargetObjectMetadataUniversalIdentifier": "43976081-def7-5c5c-8b96-89456688637e",
  "relationTargetFieldMetadataUniversalIdentifier": "f0d35e87-1f4c-5b0d-b5ba-7997cc9216ac",
  "universalSettings": {
    "relationType": RelationType.ONE_TO_MANY
  }
});
