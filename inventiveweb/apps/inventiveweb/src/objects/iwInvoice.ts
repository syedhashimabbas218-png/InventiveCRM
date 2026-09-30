import { defineObject, FieldType, MetadataWritability } from 'twenty-sdk/define';
export default defineObject({
  "universalIdentifier": "df0f21bd-4190-5f33-8a76-f09452268c51",
  "nameSingular": "iwInvoice",
  "namePlural": "iwInvoices",
  "labelSingular": "Invoice",
  "labelPlural": "Invoices",
  "description": "Managed through verified business actions. Record editing is restricted.",
  "icon": "IconReceipt",
  "fields": [
    {
      "universalIdentifier": "26357c28-d3e5-5e6e-9bd8-7a9691ef8afb",
      "name": "name",
      "type": FieldType.TEXT,
      "label": "Name",
      "isNullable": false,
      "defaultValue": "''"
    },
    {
      "universalIdentifier": "1ae2d680-0c79-532f-830c-e3601a5f306b",
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
          "value": "ISSUED",
          "label": "Issued",
          "position": 1,
          "color": "blue"
        },
        {
          "value": "PAID",
          "label": "Paid",
          "position": 2,
          "color": "green"
        },
        {
          "value": "VOID",
          "label": "Void",
          "position": 3,
          "color": "orange"
        }
      ]
    },
    {
      "universalIdentifier": "a1411f55-e6d2-5725-80bc-7c270bfe9386",
      "name": "currencyCode",
      "type": FieldType.TEXT,
      "label": "Currency",
      "isNullable": true
    },
    {
      "universalIdentifier": "39649bd6-03f8-5da5-ba76-dd56762e5f45",
      "name": "invoiceNumber",
      "type": FieldType.TEXT,
      "label": "Invoice number",
      "isNullable": true
    },
    {
      "universalIdentifier": "559ce0d4-5e28-5398-9c97-b89f65c2043e",
      "name": "dueAt",
      "type": FieldType.DATE,
      "label": "Due date",
      "isNullable": true
    },
    {
      "universalIdentifier": "bd32c2de-26dc-58dd-9d00-e98bcc761753",
      "name": "accountingReference",
      "type": FieldType.TEXT,
      "label": "Accounting reference",
      "isNullable": true
    },
    {
      "universalIdentifier": "ae36c600-53fa-588b-a8c5-b10c91a08d66",
      "name": "answers",
      "type": FieldType.RAW_JSON,
      "label": "Submitted answers",
      "isNullable": true
    }
  ],
  "writability": MetadataWritability.APPLICATION
});
