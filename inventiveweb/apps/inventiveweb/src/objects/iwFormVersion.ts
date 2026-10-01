import { defineObject, FieldType, MetadataWritability } from 'twenty-sdk/define';
export default defineObject({
  "universalIdentifier": "c774ad97-9749-56ed-bf78-733e0b8275b4",
  "nameSingular": "iwFormVersion",
  "namePlural": "iwFormVersions",
  "labelSingular": "Form version",
  "labelPlural": "Form versions",
  "description": "Managed through verified business actions. Record editing is restricted.",
  "icon": "IconVersions",
  "fields": [
    {
      "universalIdentifier": "b8be144b-6f9f-5f83-ac44-0ec71b069e13",
      "name": "name",
      "type": FieldType.TEXT,
      "label": "Name",
      "isNullable": false,
      "defaultValue": "''"
    },
    {
      "universalIdentifier": "3b115ed7-261d-5ae5-a5a2-ed80b7b1fdaa",
      "name": "version",
      "type": FieldType.NUMBER,
      "label": "Version",
      "isNullable": true
    },
    {
      "universalIdentifier": "5cd2a9df-4818-5067-82b1-2806b9aad0e4",
      "name": "schemaJson",
      "type": FieldType.RAW_JSON,
      "label": "Published definition",
      "isNullable": true
    },
    {
      "universalIdentifier": "faba8547-f641-5991-98b5-e581b23878f5",
      "name": "publishedAt",
      "type": FieldType.DATE_TIME,
      "label": "Published at",
      "isNullable": true
    },
    {
      "universalIdentifier": "afdebe48-8c79-5063-8471-344a96eb5d2d",
      "name": "snapshotKey",
      "type": FieldType.TEXT,
      "label": "Snapshot key",
      "isNullable": true
    },
    {
      "universalIdentifier": "179c5ecf-9d21-5273-8777-684ee5140c72",
      "name": "purpose",
      "type": FieldType.TEXT,
      "label": "Used for",
      "isNullable": true
    },
    {
      "universalIdentifier": "dc023b7d-8d14-5d24-b69a-e4eb37d0e7a4",
      "name": "publishedBy",
      "type": FieldType.TEXT,
      "label": "Published by member",
      "isNullable": true
    }
  ],
  "writability": MetadataWritability.APPLICATION
});
