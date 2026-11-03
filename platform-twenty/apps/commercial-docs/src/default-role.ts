import { defineApplicationRole, SystemPermissionFlag } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

// Logic functions run under this role: they read clients and price lists, write quotes and invoices, and add attachments.
export default defineApplicationRole({
  universalIdentifier: IDS.defaultRole,
  label: 'Quotes & Invoices functions',
  description: 'Role used by the Quotes & Invoices logic functions.',
  canReadAllObjectRecords: true,
  canUpdateAllObjectRecords: true,
  canSoftDeleteAllObjectRecords: false,
  canDestroyAllObjectRecords: false,
  canBeAssignedToUsers: false,
  canBeAssignedToApiKeys: false,
  // PDFs are uploaded to the document and the client card, and can be sent from the business's connected mailbox.
  permissionFlagUniversalIdentifiers: [SystemPermissionFlag.UPLOAD_FILE, SystemPermissionFlag.SEND_EMAIL_TOOL],
});
