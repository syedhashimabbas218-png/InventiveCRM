import { defineApplicationRole } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

// Reads contacts and lists to build audiences, writes its own records and withdraws consent on unsubscribe.
export default defineApplicationRole({
  universalIdentifier: IDS.role,
  label: 'Campaign Studio functions',
  description: 'Role used by the Campaign Studio logic functions.',
  canReadAllObjectRecords: true,
  canUpdateAllObjectRecords: true,
  canSoftDeleteAllObjectRecords: true,
  canDestroyAllObjectRecords: false,
  canBeAssignedToUsers: false,
  canBeAssignedToApiKeys: false,
});
