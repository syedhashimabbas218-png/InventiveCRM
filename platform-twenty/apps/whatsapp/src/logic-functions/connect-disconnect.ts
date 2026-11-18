import { defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { asApplication } from 'src/lib/api';
import { disconnectKey } from 'src/lib/connect';

type DisconnectPayload = { connectionProviderName: string; connectedAccountId: string };

// Twenty runs this before it deletes the connection, so the key can still disable our InventiveChat webhook.
const handler = async (payload: DisconnectPayload) => {
  try {
    return await asApplication(() => disconnectKey(payload.connectedAccountId));
  } catch (error) {
    console.error(`whatsapp: the InventiveChat webhook could not be disabled on disconnect: ${(error as Error).message}`);
    return { disabled: 0 };
  }
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.disconnect,
  name: 'whatsapp-connect-disconnect',
  description: 'When InventiveChat is disconnected, disables this workspace’s webhook there.',
  timeoutSeconds: 30,
  handler,
});
