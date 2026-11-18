import { defineIndex } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

// The inbox lists open (or closed) conversations newest first on every load and change.
export default defineIndex({
  universalIdentifier: IDS.indexes.conversationStatusLastMessageAt.index,
  objectUniversalIdentifier: IDS.conversation.object,
  fields: [
    { universalIdentifier: IDS.indexes.conversationStatusLastMessageAt.status, fieldUniversalIdentifier: IDS.conversation.fields.status },
    { universalIdentifier: IDS.indexes.conversationStatusLastMessageAt.lastMessageAt, fieldUniversalIdentifier: IDS.conversation.fields.lastMessageAt },
  ],
});
