import { defineApplication } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineApplication({
  universalIdentifier: IDS.application,
  displayName: 'Team chat',
  description: 'Chat with your team inside the CRM: channels, direct messages, @mentions and links to customers, deals and other records.',
  author: 'InventiveWeb.studio',
  category: 'Productivity',
  serverVariables: {
    CHAT_SECRET: { description: 'Random secret (openssl rand -hex 32) that encrypts chat messages. Changing it makes existing messages unreadable.', isSecret: true },
  },
});
