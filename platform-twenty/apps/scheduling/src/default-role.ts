import { defineApplicationRole } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

// Freed reservations must be destroyed, not soft-deleted: soft-deleted rows still hold their unique key.
export default defineApplicationRole({
  universalIdentifier: IDS.role,
  label: 'Scheduling functions',
  description: 'Role used by the Scheduling logic functions.',
  canReadAllObjectRecords: true,
  canUpdateAllObjectRecords: true,
  canSoftDeleteAllObjectRecords: true,
  canDestroyAllObjectRecords: false,
  canBeAssignedToUsers: false,
  canBeAssignedToApiKeys: false,
  objectPermissions: [
    {
      objectUniversalIdentifier: IDS.slotReservation.object,
      canReadObjectRecords: true,
      canUpdateObjectRecords: true,
      canSoftDeleteObjectRecords: true,
      canDestroyObjectRecords: true,
    },
    {
      objectUniversalIdentifier: IDS.publicRequestCounter.object,
      canReadObjectRecords: true,
      canUpdateObjectRecords: true,
      canSoftDeleteObjectRecords: true,
      canDestroyObjectRecords: true,
    },
  ],
});
