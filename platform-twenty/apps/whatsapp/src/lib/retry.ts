import { forwardStatus } from 'src/lib/callbacks';
import { catchUp } from 'src/lib/catch-up';
import { sendTemplateToConversation, sendTemplateToPhone, type TemplateMessage } from 'src/lib/inventivechat';
import { isE164 } from 'src/lib/phones';
import { createChangeSet } from 'src/lib/realtime';
import { conversationByInventiveChatId, getPerson, type MessageRow, messagesDueForRetry, updateMessage } from 'src/lib/records';
import { isLanguageCode, isTemplateName, templateValues } from 'src/lib/rules';
import { attemptSend, conversationForSend, finishSend, SendDeferred, SendRefused, type StoredSend } from 'src/lib/sending';
import { contextFor, loadSettings, ownOrigins } from 'src/lib/settings';

const RUN_BUDGET_MS = 40_000;
// An idle catch-up takes a second; after an outage the server's write speed sets the pace, so a run may take minutes.
const CATCH_UP_BUDGET_MS = 150_000;
const BATCH = 60;
const CONCURRENT_SENDS = 3;

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

export const readStoredSend = (value: unknown): StoredSend | null => {
  const stored = asRecord(typeof value === 'string' ? (() => { try { return JSON.parse(value) as unknown; } catch { return null; } })() : value);
  const template = asRecord(stored.template);
  if (!isTemplateName(template.name) || !isLanguageCode(template.languageCode)) return null;
  const parsed: TemplateMessage = { name: template.name, languageCode: template.languageCode, parameters: templateValues(template.parameters) };
  if (stored.route === 'phone' && isE164(stored.to)) return { route: 'phone', to: stored.to, template: parsed };
  if (stored.route === 'conversation' && typeof stored.conversationId === 'string' && stored.conversationId) return { route: 'conversation', conversationId: stored.conversationId, template: parsed };
  return null;
};

// Catches up on events missed while the CRM was unreachable, then sends the notifications InventiveChat asked us to
// hold back, and gives up on any that waited a whole day.
export const runRetries = async () => {
  const settings = await loadSettings();
  const context = await contextFor(settings).catch(() => null);
  if (!settings || !context) return { skipped: 'WhatsApp is not connected.' };
  const changes = createChangeSet();
  const caughtUp = await catchUp(settings, context, Date.now() + CATCH_UP_BUDGET_MS, changes).catch((error: Error) => {
    console.error(`whatsapp catch-up: ${error.stack ?? error.message}`);
    return { failed: error.message };
  });
  const deadline = Date.now() + RUN_BUDGET_MS;
  const queue = await messagesDueForRetry(new Date().toISOString(), BATCH);
  let cachedOrigins: Promise<string[]> | null = null;
  const origins = () => (cachedOrigins ??= ownOrigins());
  const outcome = { sent: 0, waiting: 0, failed: 0 };

  const report = async (record: MessageRow, status: 'SENT' | 'FAILED') => {
    if (record.deliveryId && record.statusCallbackUrl) await forwardStatus(record, status, await origins()).catch((error: Error) => console.error(`whatsapp retry: status callback failed: ${error.message}`));
  };

  const retry = async (record: MessageRow) => {
    const stored = readStoredSend(record.sendPayload);
    if (!stored) {
      const failed = await updateMessage(record.id, { status: 'FAILED', retryAt: null, error: 'This message cannot be sent again: what to send was not kept.' });
      outcome.failed += 1;
      return report(failed, 'FAILED');
    }
    try {
      const result = await attemptSend({
        record,
        deadline,
        changes,
        deferrable: true,
        run: (idempotencyKey) =>
          stored.route === 'phone'
            ? sendTemplateToPhone(context, { to: stored.to, whatsappAccountId: settings.whatsappAccountId, template: stored.template, idempotencyKey, correlation: record.id })
            : sendTemplateToConversation(context, { conversationId: stored.conversationId, template: stored.template, idempotencyKey, correlation: record.id }),
      });
      const person = record.personId ? await getPerson(record.personId) : null;
      const conversation = stored.route === 'phone' ? await conversationForSend(result, stored.to, person, changes) : await conversationByInventiveChatId(stored.conversationId);
      await report(await finishSend(record, result, conversation, changes), 'SENT');
      outcome.sent += 1;
    } catch (error) {
      if (error instanceof SendDeferred) outcome.waiting += 1;
      else if (error instanceof SendRefused && error.record?.status === 'FAILED') {
        outcome.failed += 1;
        await report(error.record, 'FAILED');
      } else if (error instanceof SendRefused) outcome.waiting += 1;
      else throw error;
    }
  };

  const worker = async () => {
    for (let record = queue.shift(); record && Date.now() < deadline; record = queue.shift()) await retry(record);
  };
  try {
    await Promise.all(Array.from({ length: CONCURRENT_SENDS }, worker));
  } finally {
    await changes.publish();
  }
  return { ...outcome, catchUp: caughtUp };
};
