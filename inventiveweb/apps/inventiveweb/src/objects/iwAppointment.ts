import { defineObject, FieldType, MetadataWritability } from 'twenty-sdk/define';
export default defineObject({
  "universalIdentifier": "2049812f-baf9-5981-a6a6-80cd7ff6081d",
  "nameSingular": "iwAppointment",
  "namePlural": "iwAppointments",
  "labelSingular": "Appointment",
  "labelPlural": "Appointments",
  "description": "Managed through verified business actions. Record editing is restricted.",
  "icon": "IconCalendarEvent",
  "fields": [
    {
      "universalIdentifier": "1f5499e4-35f9-5dc4-b6d3-981b450a66fe",
      "name": "name",
      "type": FieldType.TEXT,
      "label": "Name",
      "isNullable": false,
      "defaultValue": "''"
    },
    {
      "universalIdentifier": "48c07511-933e-582f-bbf6-167e3cff8907",
      "name": "startsAt",
      "type": FieldType.DATE_TIME,
      "label": "Starts at",
      "isNullable": true
    },
    {
      "universalIdentifier": "e2eeba9d-3d52-5a04-b73f-74ebdb71ae1e",
      "name": "endsAt",
      "type": FieldType.DATE_TIME,
      "label": "Ends at",
      "isNullable": true
    },
    {
      "universalIdentifier": "10daeb15-d629-5a76-b376-5237057ac276",
      "name": "timeZone",
      "type": FieldType.TEXT,
      "label": "Time zone",
      "isNullable": true
    },
    {
      "universalIdentifier": "f6dc68f9-b65c-5e9b-8047-b4cb9b6b3ff9",
      "name": "status",
      "type": FieldType.SELECT,
      "label": "Status",
      "isNullable": true,
      "options": [
        {
          "value": "REQUESTED",
          "label": "Requested",
          "position": 0,
          "color": "gray"
        },
        {
          "value": "CONFIRMED",
          "label": "Confirmed",
          "position": 1,
          "color": "blue"
        },
        {
          "value": "CANCELLED",
          "label": "Cancelled",
          "position": 2,
          "color": "green"
        },
        {
          "value": "COMPLETED",
          "label": "Completed",
          "position": 3,
          "color": "orange"
        }
      ]
    },
    {
      "universalIdentifier": "57914bbc-5beb-53a1-8159-3310206b63f8",
      "name": "provider",
      "type": FieldType.SELECT,
      "label": "Calendar provider",
      "isNullable": true,
      "options": [
        {
          "value": "GOOGLE",
          "label": "Google",
          "position": 0,
          "color": "gray"
        },
        {
          "value": "MICROSOFT",
          "label": "Microsoft",
          "position": 1,
          "color": "blue"
        }
      ]
    },
    {
      "universalIdentifier": "b4a05ec2-39d3-5ad2-b4bd-9affffe3a11a",
      "name": "providerEventId",
      "type": FieldType.TEXT,
      "label": "Provider event reference",
      "isNullable": true
    },
    {
      "universalIdentifier": "12ed786d-2ed2-573e-883c-99e13f365ea8",
      "name": "answers",
      "type": FieldType.RAW_JSON,
      "label": "Submitted answers",
      "isNullable": true
    }
  ],
  "writability": MetadataWritability.APPLICATION
});
