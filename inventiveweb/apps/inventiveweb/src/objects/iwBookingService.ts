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
    },
    {
      "universalIdentifier": "4cfe2424-0d0d-4822-8f69-e64aaa5c15b9",
      "name": "assignedStaffIds",
      "type": FieldType.RAW_JSON,
      "label": "Assigned staff IDs",
      "isNullable": true
    },
    {
      "universalIdentifier": "a3369382-f46f-4660-be2a-0565d7047e73",
      "name": "calendarId",
      "type": FieldType.TEXT,
      "label": "Calendar to use",
      "isNullable": true
    },
    {
      "universalIdentifier": "bc95e7b5-93d3-4dc6-9c22-92ee7655a9a4",
      "name": "workingHours",
      "type": FieldType.RAW_JSON,
      "label": "Working hours",
      "isNullable": true
    },
    {
      "universalIdentifier": "5db8f473-6260-4e5e-a1f2-1517c5f742b1",
      "name": "bookingLeadTimeMinutes",
      "type": FieldType.NUMBER,
      "label": "Booking lead time minutes",
      "isNullable": true
    },
    {
      "universalIdentifier": "ec160803-ccc7-41a2-90ab-7029b16c2abc",
      "name": "bookingMaxDaysAhead",
      "type": FieldType.NUMBER,
      "label": "Booking max days ahead",
      "isNullable": true
    },
    {
      "universalIdentifier": "d8a8c7d4-02e2-4b8f-a6f8-cae94cdab17d",
      "name": "cancellationPolicy",
      "type": FieldType.TEXT,
      "label": "Cancellation policy",
      "isNullable": true
    }
  ]
});
