import { defineApplication } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineApplication({
  universalIdentifier: IDS.application,
  displayName: 'Quotes & Invoices',
  description:
    'UK quotes, VAT invoices, credit notes and recurring billing. PDFs are generated and filed on the client card automatically.',
  author: 'InventiveWeb.studio',
  category: 'Sales',
});
