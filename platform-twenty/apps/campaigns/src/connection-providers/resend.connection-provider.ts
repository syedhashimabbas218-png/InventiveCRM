import { defineConnectionProvider } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

// The client pastes their own Resend API key on our connect page; Twenty stores it encrypted as the token.
export default defineConnectionProvider({
  universalIdentifier: IDS.connectionProviders.resend,
  name: 'resend-email',
  displayName: 'Resend (email campaigns)',
  type: 'custom',
  scope: 'USER',
  custom: {
    authorizeLogicFunction: { universalIdentifier: IDS.logicFunctions.connectAuthorize },
    callbackLogicFunction: { universalIdentifier: IDS.logicFunctions.connectCallback },
  },
});
