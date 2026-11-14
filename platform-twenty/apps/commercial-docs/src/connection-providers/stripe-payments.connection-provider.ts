import { defineConnectionProvider } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

// The client pastes their own secret key on our connect page; Twenty stores it encrypted as this connection's token.
export default defineConnectionProvider({
  universalIdentifier: IDS.connectionProviders.stripe,
  name: 'stripe-payments',
  displayName: 'Stripe (payments)',
  type: 'custom',
  scope: 'USER',
  custom: {
    authorizeLogicFunction: { universalIdentifier: IDS.logicFunctions.paymentsAuthorize },
    callbackLogicFunction: { universalIdentifier: IDS.logicFunctions.paymentsCallback },
  },
});
