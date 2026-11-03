import { defineLogicFunction } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { publicBaseUrl } from 'src/lib/notify';
import { embedScript } from 'src/lib/page';

const handler = async () =>
  new Response(embedScript(await publicBaseUrl()), {
    status: 200,
    headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.embedScript,
  name: 'embed-script',
  description: 'Script for inline, popup and floating-button booking widgets on other websites.',
  timeoutSeconds: 15,
  httpRouteTriggerSettings: { path: '/booking/embed.js', httpMethod: 'GET', isAuthRequired: false },
  handler,
});
