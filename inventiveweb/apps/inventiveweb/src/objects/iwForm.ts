import { defineObject, FieldType } from 'twenty-sdk/define';
export default defineObject({
  "universalIdentifier": "fa0682a5-6e6c-5318-b629-ce39ab908d36",
  "nameSingular": "iwForm",
  "namePlural": "iwForms",
  "labelSingular": "Form",
  "labelPlural": "Forms",
  "description": "Business-specific configuration.",
  "icon": "IconForms",
  "fields": [
    {
      "universalIdentifier": "d6565e12-de4a-5a71-a5ab-cb915abc81ee",
      "name": "name",
      "type": FieldType.TEXT,
      "label": "Name",
      "isNullable": false,
      "defaultValue": "''"
    },
    {
      "universalIdentifier": "f60bc9a6-1315-528a-b2d2-203241989052",
      "name": "purpose",
      "type": FieldType.SELECT,
      "label": "Used for",
      "isNullable": true,
      "options": [
        {
          "value": "APPOINTMENT",
          "label": "Appointment",
          "position": 0,
          "color": "gray"
        },
        {
          "value": "QUOTE",
          "label": "Quote",
          "position": 1,
          "color": "blue"
        },
        {
          "value": "INVOICE",
          "label": "Invoice",
          "position": 2,
          "color": "green"
        }
      ]
    },
    {
      "universalIdentifier": "a24c2286-9c6b-5e9d-9fd9-f75eb6c33e18",
      "name": "schemaJson",
      "type": FieldType.RAW_JSON,
      "label": "Form definition",
      "isNullable": true
    },
    {
      "universalIdentifier": "d626ea3b-2b61-5847-83b6-1c79f99513b7",
      "name": "description",
      "type": FieldType.TEXT,
      "label": "Description",
      "isNullable": true
    }
  ]
});
