import { defineField, FieldType, RelationType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';
export default defineField({
  "universalIdentifier": "017615b4-9e7a-41e1-b49d-23c097ee3e9d",
  "objectUniversalIdentifier": STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  "type": FieldType.RELATION,
  "name": "iwStaffCalendars",
  "label": "Staff calendars",
  "relationTargetObjectMetadataUniversalIdentifier": "86baf605-586a-4588-ae42-e857115f0d16",
  "relationTargetFieldMetadataUniversalIdentifier": "a147e566-e389-46dd-b1f0-4026f337cba1",
  "universalSettings": {
    "relationType": RelationType.ONE_TO_MANY
  }
});
