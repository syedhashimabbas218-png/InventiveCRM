import { defineApplicationRole } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

// Reads appointments and invoices to find who to ask, writes its own records, and creates follow-up tasks.
export default defineApplicationRole({
  universalIdentifier: IDS.role,
  label: 'Feedback functions',
  description: 'Role used by the Feedback logic functions.',
  canReadAllObjectRecords: true,
  canUpdateAllObjectRecords: true,
  canSoftDeleteAllObjectRecords: false,
  canDestroyAllObjectRecords: false,
  canBeAssignedToUsers: false,
  canBeAssignedToApiKeys: false,
});
