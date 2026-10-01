import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
export default defineField({
  "universalIdentifier": "bc620bb5-b01f-5940-b8cc-9f2a84cd0ef3",
  "objectUniversalIdentifier": "c774ad97-9749-56ed-bf78-733e0b8275b4",
  "type": FieldType.RELATION,
  "name": "quotes",
  "label": "Quotes",
  "relationTargetObjectMetadataUniversalIdentifier": "43976081-def7-5c5c-8b96-89456688637e",
  "relationTargetFieldMetadataUniversalIdentifier": "5a8c0774-3071-51c8-aa57-9257b726af6f",
  "universalSettings": {
    "relationType": RelationType.ONE_TO_MANY
  }
});
