import { defineApplicationRole } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

// Reads workspace members and writes chat records; it never touches other CRM data.
export default defineApplicationRole({
  universalIdentifier: IDS.role,
  label: 'Team chat functions',
  description: 'Role used by the Team chat logic function.',
  canReadAllObjectRecords: true,
  canUpdateAllObjectRecords: true,
  canSoftDeleteAllObjectRecords: true,
  canDestroyAllObjectRecords: false,
  canBeAssignedToUsers: false,
  canBeAssignedToApiKeys: false,
});
