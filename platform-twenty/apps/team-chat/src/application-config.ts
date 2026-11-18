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
    REALTIME_SECRET: { description: 'Shared with the realtime service (platform-twenty/realtime): signs live update notices and passes.', isSecret: true },
    REALTIME_INTERNAL_URL: { description: 'Where app functions publish live updates, e.g. http://realtime:3200.' },
    REALTIME_PUBLIC_URL: { description: 'Where browsers receive live updates, e.g. https://realtime.crm.inventiveweb.studio.' },
  },
});
