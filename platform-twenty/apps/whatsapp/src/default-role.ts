import { defineApplicationRole } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

// Matches people by phone, creates unknown senders as people, writes WhatsApp records and clears consent on opt-out.
export default defineApplicationRole({
  universalIdentifier: IDS.role,
  label: 'WhatsApp functions',
  description: 'Role used by the WhatsApp logic functions.',
  canReadAllObjectRecords: true,
  canUpdateAllObjectRecords: true,
  canSoftDeleteAllObjectRecords: false,
  canDestroyAllObjectRecords: false,
  canBeAssignedToUsers: false,
  canBeAssignedToApiKeys: false,
});
