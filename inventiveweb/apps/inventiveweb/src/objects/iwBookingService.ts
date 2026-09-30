import { defineObject, FieldType } from 'twenty-sdk/define';
export default defineObject({
  "universalIdentifier": "ec57b32a-bd86-52d6-8a14-8471bf453c73",
  "nameSingular": "iwBookingService",
  "namePlural": "iwBookingServices",
  "labelSingular": "Booking service",
  "labelPlural": "Booking services",
  "description": "Business-specific configuration.",
  "icon": "IconCalendarPlus",
  "fields": [
    {
      "universalIdentifier": "05140661-a68c-52db-9737-b7e6cd361b6d",
      "name": "name",
      "type": FieldType.TEXT,
      "label": "Name",
      "isNullable": false,
      "defaultValue": "''"
    },
    {
      "universalIdentifier": "7d026d9e-647d-58fc-a67d-60df87ce1834",
      "name": "durationMinutes",
      "type": FieldType.NUMBER,
      "label": "Duration in minutes",
      "isNullable": true
    },
    {
      "universalIdentifier": "946d99ee-16de-5483-90e5-face347bb7b4",
      "name": "bufferBeforeMinutes",
      "type": FieldType.NUMBER,
      "label": "Buffer before",
      "isNullable": true
    },
    {
      "universalIdentifier": "55fb8069-4add-5715-aa68-021e1e803204",
      "name": "bufferAfterMinutes",
      "type": FieldType.NUMBER,
      "label": "Buffer after",
      "isNullable": true
    },
    {
      "universalIdentifier": "4c80a913-4bce-5f6d-ad87-eb55ec85d530",
      "name": "timeZone",
      "type": FieldType.TEXT,
      "label": "Time zone",
      "isNullable": true
    },
    {
      "universalIdentifier": "b3fa6d16-c0c3-5ef8-9254-4c886db95852",
      "name": "location",
      "type": FieldType.TEXT,
      "label": "Location",
      "isNullable": true
    },
    {
      "universalIdentifier": "4a0eeb54-2044-518c-9377-8a157848315f",
      "name": "isActive",
      "type": FieldType.BOOLEAN,
      "label": "Active",
      "isNullable": true
    },
    {
      "universalIdentifier": "aa454fc6-9f35-5659-91c4-81e4e603aa23",
      "name": "description",
      "type": FieldType.TEXT,
      "label": "Description",
      "isNullable": true
    }
  ]
});
