import { defineConnectionProvider } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

// The client pastes their own Resend API key on our connect page; Twenty stores it encrypted as the token. One
// account per workspace, so every campaign goes out through the same Resend account whoever connected it.
export default defineConnectionProvider({
  universalIdentifier: IDS.connectionProviders.resend,
  name: 'resend-campaigns',
  displayName: 'Resend (email campaigns)',
  type: 'custom',
  scope: 'WORKSPACE',
  custom: {
    authorizeLogicFunction: { universalIdentifier: IDS.logicFunctions.connectAuthorize },
    callbackLogicFunction: { universalIdentifier: IDS.logicFunctions.connectCallback },
  },
});
