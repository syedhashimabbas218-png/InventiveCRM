import { defineConnectionProvider } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

// An admin pastes the workspace's InventiveChat API key on our connect page; Twenty stores it encrypted as the token.
// One account per workspace, so every conversation and notification goes through the same WhatsApp number.
export default defineConnectionProvider({
  universalIdentifier: IDS.connectionProviders.inventiveChat,
  name: 'inventivechat',
  displayName: 'InventiveChat (WhatsApp)',
  type: 'custom',
  scope: 'WORKSPACE',
  onDisconnectLogicFunction: { universalIdentifier: IDS.logicFunctions.disconnect },
  custom: {
    authorizeLogicFunction: { universalIdentifier: IDS.logicFunctions.connectAuthorize },
    callbackLogicFunction: { universalIdentifier: IDS.logicFunctions.connectCallback },
  },
});
