import { defineApplication } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineApplication({
  universalIdentifier: IDS.application,
  displayName: 'WhatsApp',
  description: 'WhatsApp conversations inside the CRM through your InventiveChat account: a shared inbox, conversations on contact and company pages, templates and automations.',
  author: 'InventiveWeb.studio',
  category: 'Communication',
  serverVariables: {
    INVENTIVECHAT_API_URL: { description: 'Base address of the InventiveChat API for this server, for example https://chat.inventiveweb.studio (the app adds /v1).' },
    WHATSAPP_APP_SECRET: { description: 'Random secret (openssl rand -hex 32) that encrypts the InventiveChat webhook secret stored in each workspace.', isSecret: true },
    WHATSAPP_GATEWAY_SECRET: { description: 'Shared secret the other apps sign WhatsApp notifications with (WHATSAPP_HANDOFF.md). Use the same value as in those apps.', isSecret: true },
    REALTIME_INTERNAL_URL: { description: 'Address of the realtime hub as the server reaches it, for example http://realtime:3200. Empty turns live updates off.' },
    REALTIME_PUBLIC_URL: { description: 'Address of the realtime hub as browsers reach it.' },
    REALTIME_SECRET: { description: 'Shared secret (32+ characters) signing publishes to the realtime hub and the tokens browsers connect with.', isSecret: true },
  },
});
