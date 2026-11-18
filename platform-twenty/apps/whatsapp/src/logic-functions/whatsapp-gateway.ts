import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { asApplication } from 'src/lib/api';
import { verifyBodySignature } from 'src/lib/crypto';
import { effectiveMapping, planGatewayRequest, runGatewayPlan } from 'src/lib/gateway';
import { createChangeSet } from 'src/lib/realtime';
import { contextFor, loadSettings, ownOrigins } from 'src/lib/settings';

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const handler = async (event: RoutePayload<Record<string, unknown>>) => {
  const startedAt = Date.now();
  const rawBody = event.rawBody ?? '';
  if (!verifyBodySignature({ secret: process.env.WHATSAPP_GATEWAY_SECRET, timestamp: event.headers['x-inventivecrm-timestamp'], signature: event.headers['x-inventivecrm-signature'], rawBody }))
    return json(401, { error: 'Invalid signature.' });
  let body: unknown = event.body;
  if (!body) {
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      return json(400, { error: 'The body must be JSON.' });
    }
  }
  return asApplication(async () => {
    const settings = await loadSettings();
    const context = await contextFor(settings).catch(() => null);
    if (!settings || !context) return json(503, { error: 'WhatsApp is not connected in this workspace yet.' });
    const plan = planGatewayRequest(body, { mapping: effectiveMapping(settings.gatewayTemplates), origins: await ownOrigins() });
    if (plan.kind === 'error') return json(plan.status, { error: plan.error });
    const changes = createChangeSet();
    try {
      const answer = await runGatewayPlan(plan, { context, settings, changes, startedAt });
      return json(answer.status, answer.body);
    } catch (error) {
      console.error(`whatsapp gateway: ${(error as Error).stack ?? error}`);
      return json(500, { error: 'The WhatsApp message could not be sent.' });
    } finally {
      await changes.publish();
    }
  });
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.gateway,
  name: 'whatsapp-gateway',
  description: 'Signed WhatsApp gateway for the other apps (WHATSAPP_HANDOFF.md): invoices, quotes, reminders, surveys and campaign batches.',
  timeoutSeconds: 30,
  httpRouteTriggerSettings: { path: '/whatsapp/gateway', httpMethod: 'POST', isAuthRequired: false, forwardedRequestHeaders: ['x-inventivecrm-timestamp', 'x-inventivecrm-signature'] },
  handler,
});
