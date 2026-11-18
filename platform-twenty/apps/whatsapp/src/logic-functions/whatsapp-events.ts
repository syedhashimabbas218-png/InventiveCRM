import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { asApplication } from 'src/lib/api';
import { handleWebhook } from 'src/lib/events';
import { parseWebhook, verifyWebhook, WEBHOOK_HEADERS } from 'src/lib/inventivechat';
import { createChangeSet } from 'src/lib/realtime';
import { loadSettings, webhookSecretOf } from 'src/lib/settings';

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const parseBody = (event: RoutePayload<Record<string, unknown>>) => {
  if (event.body) return event.body;
  try {
    return JSON.parse(event.rawBody ?? '') as unknown;
  } catch {
    return null;
  }
};

const handler = async (event: RoutePayload<Record<string, unknown>>) =>
  asApplication(async () => {
    const settings = await loadSettings();
    const secret = settings ? webhookSecretOf(settings) : null;
    // 503 lets InventiveChat retry while the workspace is still being connected.
    if (!settings || !secret) return json(503, { error: 'WhatsApp is not connected in this workspace.' });
    if (!verifyWebhook(secret, event.rawBody ?? '', event.headers)) return json(401, { error: 'Invalid signature.' });
    const parsed = parseWebhook(parseBody(event), event.headers['x-event-type']);
    if (!parsed) return json(400, { error: 'Unrecognised event.' });
    if (parsed.tenantId !== settings.tenantId) return json(403, { error: 'This event belongs to another InventiveChat account.' });
    const changes = createChangeSet();
    try {
      return json(200, { ok: true, ...(await handleWebhook(parsed, settings, changes)) });
    } catch (error) {
      // A 500 makes InventiveChat retry; every step is idempotent, so a retry finishes what this run started.
      console.error(`whatsapp webhook ${event.headers['x-event-id'] ?? ''}: ${(error as Error).stack ?? error}`);
      return json(500, { error: 'The event could not be processed.' });
    } finally {
      await changes.publish();
    }
  });

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.events,
  name: 'whatsapp-events',
  description: 'Receives signed InventiveChat webhooks: new messages, delivery statuses, hand-offs, opt-outs and consent changes.',
  timeoutSeconds: 15,
  httpRouteTriggerSettings: { path: '/whatsapp/events', httpMethod: 'POST', isAuthRequired: false, forwardedRequestHeaders: WEBHOOK_HEADERS },
  handler,
});
