import { defineConnectionProvider } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

// The client pastes their own secret key on our connect page; Twenty stores it encrypted as this connection's token.
// One account per workspace: a per-user key would let any member route customer payments to their own account.
export default defineConnectionProvider({
  universalIdentifier: IDS.connectionProviders.stripe,
  name: 'stripe-account',
  displayName: 'Stripe (payments)',
  type: 'custom',
  scope: 'WORKSPACE',
  custom: {
    authorizeLogicFunction: { universalIdentifier: IDS.logicFunctions.paymentsAuthorize },
    callbackLogicFunction: { universalIdentifier: IDS.logicFunctions.paymentsCallback },
  },
});
