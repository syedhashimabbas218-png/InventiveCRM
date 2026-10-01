import { defineObject, FieldType, MetadataWritability } from 'twenty-sdk/define';
export default defineObject({
  "universalIdentifier": "43976081-def7-5c5c-8b96-89456688637e",
  "nameSingular": "iwQuote",
  "namePlural": "iwQuotes",
  "labelSingular": "Quote",
  "labelPlural": "Quotes",
  "description": "Managed through verified business actions. Record editing is restricted.",
  "icon": "IconFileDescription",
  "fields": [
    {
      "universalIdentifier": "f8f76163-0890-5a5b-9b2c-1423e9e7e07c",
      "name": "name",
      "type": FieldType.TEXT,
      "label": "Name",
      "isNullable": false,
      "defaultValue": "''"
    },
    {
      "universalIdentifier": "956b99dd-b01f-5540-a0d8-dc36c7c14311",
      "name": "status",
      "type": FieldType.SELECT,
      "label": "Status",
      "isNullable": true,
      "options": [
        {
          "value": "DRAFT",
          "label": "Draft",
          "position": 0,
          "color": "gray"
        },
        {
          "value": "AWAITING_APPROVAL",
          "label": "Awaiting Approval",
          "position": 1,
          "color": "blue"
        },
        {
          "value": "APPROVED",
          "label": "Approved",
          "position": 2,
          "color": "green"
        },
        {
          "value": "SENT",
          "label": "Sent",
          "position": 3,
          "color": "orange"
        },
        {
          "value": "ACCEPTED",
          "label": "Accepted",
          "position": 4,
          "color": "red"
        },
        {
          "value": "DECLINED",
          "label": "Declined",
          "position": 5,
          "color": "gray"
        },
        {
          "value": "EXPIRED",
          "label": "Expired",
          "position": 6,
          "color": "blue"
        }
      ]
    },
    {
      "universalIdentifier": "e0c7cef4-5d16-542d-b01f-e4d09c6ddb83",
      "name": "currencyCode",
      "type": FieldType.TEXT,
      "label": "Currency",
      "isNullable": true
    },
    {
      "universalIdentifier": "432f9466-bd9e-5781-a5e7-e0883ba95419",
      "name": "lineItems",
      "type": FieldType.RAW_JSON,
      "label": "Line items",
      "isNullable": true
    },
    {
      "universalIdentifier": "5a75ba39-db19-5b80-a9d2-8d3d67afeb5f",
      "name": "answers",
      "type": FieldType.RAW_JSON,
      "label": "Submitted answers",
      "isNullable": true
    },
    {
      "universalIdentifier": "20714b13-dde5-5049-9df8-22b85c0b686e",
      "name": "validUntil",
      "type": FieldType.DATE,
      "label": "Valid until",
      "isNullable": true
    },
    {
      "universalIdentifier": "18bcc491-26c3-5a81-8a1d-60694f797284",
      "name": "platformReference",
      "type": FieldType.TEXT,
      "label": "Platform reference",
      "isNullable": true
    }
  ],
  "writability": MetadataWritability.APPLICATION
});
