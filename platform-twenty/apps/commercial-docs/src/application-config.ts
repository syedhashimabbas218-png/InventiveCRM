import { defineApplication } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineApplication({
  universalIdentifier: IDS.application,
  displayName: 'Quotes & Invoices',
  description:
    'UK quotes, VAT invoices, credit notes and recurring billing. PDFs are generated and filed on the client card automatically.',
  author: 'InventiveWeb.studio',
  category: 'Sales',
  serverVariables: {
    SMTP_HOST: { description: 'InventiveCRM mail server host, used when a business sends from our server.' },
    SMTP_PORT: { description: 'Mail server port, usually 587.' },
    SMTP_SECURITY: { description: 'TLS, STARTTLS or NONE (NONE only inside a private network).' },
    SMTP_USERNAME: { description: 'Mail server login, if it needs one.' },
    SMTP_PASSWORD: { description: 'Mail server password.', isSecret: true },
    SMTP_FROM_ADDRESS: { description: 'Sender address, e.g. invoices@inventiveweb.studio. The business name is the display name.' },
    WHATSAPP_GATEWAY_URL: { description: 'Endpoint of the WhatsApp (WABA) service that sends documents.' },
    WHATSAPP_GATEWAY_SECRET: { description: 'Shared secret that signs requests to and callbacks from the WhatsApp service.', isSecret: true },
  },
});
