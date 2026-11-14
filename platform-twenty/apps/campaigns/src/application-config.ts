import { defineApplication } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineApplication({
  universalIdentifier: IDS.application,
  displayName: 'Campaign Studio',
  description: 'Design and send email campaigns through your own Resend account, and WhatsApp campaigns through InventiveChat, to contacts who agreed to hear from you.',
  author: 'InventiveWeb.studio',
  category: 'Marketing',
  serverVariables: {
    CAMPAIGN_LINK_SECRET: { description: 'Random secret (openssl rand -hex 32) signing unsubscribe and tracking links.', isSecret: true },
    WHATSAPP_GATEWAY_URL: { description: 'InventiveChat endpoint that sends WhatsApp messages (see WHATSAPP_HANDOFF.md).' },
    WHATSAPP_GATEWAY_SECRET: { description: 'Shared secret signing requests to the WhatsApp service.', isSecret: true },
    RESEND_API_URL: { description: 'Test environments only: points the app at a Resend test double. Leave empty in production.' },
  },
});
