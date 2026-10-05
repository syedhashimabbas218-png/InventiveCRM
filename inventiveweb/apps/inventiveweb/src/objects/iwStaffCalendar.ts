import { defineObject, FieldType, MetadataWritability, RelationType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';
export default defineObject({
  "universalIdentifier": "86baf605-586a-4588-ae42-e857115f0d16",
  "nameSingular": "iwStaffCalendar",
  "namePlural": "iwStaffCalendars",
  "labelSingular": "Staff calendar",
  "labelPlural": "Staff calendars",
  "description": "Encrypted calendar connection for a staff member. Managed by the application runtime.",
  "icon": "IconCalendar",
  "fields": [
    {
      "universalIdentifier": "a147e566-e389-46dd-b1f0-4026f337cba1",
      "name": "person",
      "type": FieldType.RELATION,
      "label": "Staff member",
      "relationTargetObjectMetadataUniversalIdentifier": STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
      "relationTargetFieldMetadataUniversalIdentifier": "017615b4-9e7a-41e1-b49d-23c097ee3e9d",

      "isNullable": true,
      "universalSettings": { "relationType": RelationType.MANY_TO_ONE, "joinColumnName": "personId" }
    },
    {
      "universalIdentifier": "6af03bbe-0e6f-44d2-8d3a-71b09acf8045",
      "name": "provider",
      "type": FieldType.SELECT,
      "label": "Provider",
      "isNullable": true,
      "options": [
        { "value": "GOOGLE", "label": "Google", "position": 0, "color": "gray" },
        { "value": "MICROSOFT", "label": "Microsoft", "position": 1, "color": "blue" }
      ]
    },
    {
      "universalIdentifier": "73b99011-c53b-46b5-b8cd-6bd19c371dd9",
      "name": "providerAccountId",
      "type": FieldType.TEXT,
      "label": "Provider account",
      "isNullable": true
    },
    {
      "universalIdentifier": "b91da1c8-f8a0-49cb-bf53-71197f624503",
      "name": "providerCalendarId",
      "type": FieldType.TEXT,
      "label": "Provider calendar",
      "isNullable": true
    },
    {
      "universalIdentifier": "027c2a3b-59fe-4af0-9544-bae6aeddb0a6",
      "name": "status",
      "type": FieldType.SELECT,
      "label": "Status",
      "isNullable": true,
      "options": [
        { "value": "CONNECTED", "label": "Connected", "position": 0, "color": "green" },
        { "value": "DISCONNECTED", "label": "Disconnected", "position": 1, "color": "gray" },
        { "value": "EXPIRED", "label": "Expired", "position": 2, "color": "orange" }
      ]
    },
    {
      "universalIdentifier": "80c045db-b7c0-4659-ad42-6ad8ed112643",
      "name": "connectedAt",
      "type": FieldType.DATE_TIME,
      "label": "Connected at",
      "isNullable": true
    },
    {
      "universalIdentifier": "67ba84ba-972d-4d45-a00d-84a9f5383e6f",
      "name": "expiresAt",
      "type": FieldType.DATE_TIME,
      "label": "Token expires at",
      "isNullable": true
    },
    {
      "universalIdentifier": "d7227538-7932-436f-9c6c-f914009335a2",
      "name": "accessTokenEncrypted",
      "type": FieldType.TEXT,
      "label": "Encrypted access token",
      "isNullable": true
    },
    {
      "universalIdentifier": "e981e4ed-e580-4094-9778-8d67a8c4dfdd",
      "name": "refreshTokenEncrypted",
      "type": FieldType.TEXT,
      "label": "Encrypted refresh token",
      "isNullable": true
    },
    {
      "universalIdentifier": "fb0b84d5-d5d5-450b-bef9-be97950b0d4e",
      "name": "scopes",
      "type": FieldType.TEXT,
      "label": "Granted scopes",
      "isNullable": true
    },
    {
      "universalIdentifier": "2cd3e1ce-51e8-4a7c-b960-f9340afdf614",
      "name": "isDefault",
      "type": FieldType.BOOLEAN,
      "label": "Default calendar",
      "isNullable": true
    }
  ],
  "writability": MetadataWritability.APPLICATION
});
