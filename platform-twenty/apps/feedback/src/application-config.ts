import { defineApplication } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineApplication({
  universalIdentifier: IDS.application,
  displayName: 'Feedback',
  description: 'Asks customers for a score after an appointment or a paid invoice, alerts the team about unhappy customers and invites happy ones to leave a review.',
  author: 'InventiveWeb.studio',
  category: 'Sales',
  serverVariables: {
    FEEDBACK_LINK_SECRET: { description: 'Random secret (openssl rand -hex 32) signing survey links.', isSecret: true },
    SMTP_HOST: { description: 'Mail server for survey emails, e.g. mail.' },
    SMTP_PORT: { description: 'Mail server port, usually 587.' },
    SMTP_SECURITY: { description: 'TLS, STARTTLS or NONE (NONE only inside a private network).' },
    SMTP_USERNAME: { description: 'Mail server login, if it needs one.' },
    SMTP_PASSWORD: { description: 'Mail server password.', isSecret: true },
    SMTP_FROM_ADDRESS: { description: 'Sender address for survey emails.' },
    WHATSAPP_GATEWAY_URL: { description: 'InventiveChat endpoint that sends WhatsApp messages (see WHATSAPP_HANDOFF.md).' },
    WHATSAPP_GATEWAY_SECRET: { description: 'Shared secret signing requests to the WhatsApp service.', isSecret: true },
  },
});
