import { defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { asApplication } from 'src/lib/api';
import { runCampaigns } from 'src/lib/engine';

// Every two minutes with a run budget under two minutes, so runs never overlap.
export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.job,
  name: 'campaigns-job',
  description: 'Starts campaigns that are due, sends the next batches and refreshes campaign results.',
  timeoutSeconds: 110,
  cronTriggerSettings: { pattern: '*/2 * * * *' },
  httpRouteTriggerSettings: { path: '/campaigns/run', httpMethod: 'POST', isAuthRequired: true },
  handler: () => asApplication(() => runCampaigns()),
});
