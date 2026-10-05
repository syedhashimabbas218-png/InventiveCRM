import { defineRole } from 'twenty-sdk/define';
export default defineRole({
  "universalIdentifier": "0f0a88ab-703b-5bf8-a571-c716ce849fe3",
  "label": "InventiveWeb Bookkeeper",
  "description": "Initial module permissions; assign explicitly after reviewing CRM access.",
  "canReadAllObjectRecords": false,
  "canUpdateAllObjectRecords": false,
  "canSoftDeleteAllObjectRecords": false,
  "canDestroyAllObjectRecords": false,
  "canUpdateAllSettings": false,
  "canBeAssignedToAgents": false,
  "canBeAssignedToApiKeys": false,
  "canBeAssignedToUsers": true,
  "objectPermissions": [
    {
      "objectUniversalIdentifier": "fa0682a5-6e6c-5318-b629-ce39ab908d36",
      "canReadObjectRecords": false,
      "canUpdateObjectRecords": false,
      "canSoftDeleteObjectRecords": false,
      "canDestroyObjectRecords": false
    },
    {
      "objectUniversalIdentifier": "c774ad97-9749-56ed-bf78-733e0b8275b4",
      "canReadObjectRecords": false,
      "canUpdateObjectRecords": false,
      "canSoftDeleteObjectRecords": false,
      "canDestroyObjectRecords": false
    },
    {
      "objectUniversalIdentifier": "ec57b32a-bd86-52d6-8a14-8471bf453c73",
      "canReadObjectRecords": false,
      "canUpdateObjectRecords": false,
      "canSoftDeleteObjectRecords": false,
      "canDestroyObjectRecords": false
    },
    {
      "objectUniversalIdentifier": "2049812f-baf9-5981-a6a6-80cd7ff6081d",
      "canReadObjectRecords": false,
      "canUpdateObjectRecords": false,
      "canSoftDeleteObjectRecords": false,
      "canDestroyObjectRecords": false
    },
    {
      "objectUniversalIdentifier": "43976081-def7-5c5c-8b96-89456688637e",
      "canReadObjectRecords": true,
      "canUpdateObjectRecords": false,
      "canSoftDeleteObjectRecords": false,
      "canDestroyObjectRecords": false
    },
    {
      "objectUniversalIdentifier": "df0f21bd-4190-5f33-8a76-f09452268c51",
      "canReadObjectRecords": true,
      "canUpdateObjectRecords": false,
      "canSoftDeleteObjectRecords": false,
      "canDestroyObjectRecords": false
    }
  ]
});
