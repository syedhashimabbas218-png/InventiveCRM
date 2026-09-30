import { defineRole } from 'twenty-sdk/define';
export default defineRole({
  "universalIdentifier": "d0174bdb-d7a2-50ae-9425-43a848719a51",
  "label": "InventiveWeb Staff",
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
      "canReadObjectRecords": true,
      "canUpdateObjectRecords": false,
      "canSoftDeleteObjectRecords": false,
      "canDestroyObjectRecords": false
    },
    {
      "objectUniversalIdentifier": "c774ad97-9749-56ed-bf78-733e0b8275b4",
      "canReadObjectRecords": true,
      "canUpdateObjectRecords": false,
      "canSoftDeleteObjectRecords": false,
      "canDestroyObjectRecords": false
    },
    {
      "objectUniversalIdentifier": "ec57b32a-bd86-52d6-8a14-8471bf453c73",
      "canReadObjectRecords": true,
      "canUpdateObjectRecords": false,
      "canSoftDeleteObjectRecords": false,
      "canDestroyObjectRecords": false
    },
    {
      "objectUniversalIdentifier": "2049812f-baf9-5981-a6a6-80cd7ff6081d",
      "canReadObjectRecords": true,
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
