import { describeError, findTemplate, InventiveChatError, listTemplates, namedParameters, withRetry } from 'src/lib/inventivechat';
import { primaryPhoneOf } from 'src/lib/phones';
import { createChangeSet } from 'src/lib/realtime';
import { conversationsByPhone, getPerson, recentAutomatedSends } from 'src/lib/records';
import { cleanText, isLanguageCode, isTemplateName, isUuid, isWindowOpen } from 'src/lib/rules';
import { AUTOMATION_NEEDS_TOPIC, SendDeferred, SendRefused, sendTemplateToPerson, sendToConversation } from 'src/lib/sending';
import { contextFor, loadSettings } from 'src/lib/settings';

export type AutomationInput = { personId?: unknown; text?: unknown; topic?: unknown; templateName?: unknown; languageCode?: unknown; parameters?: unknown };

export type AutomationResult = { success: boolean; message: string; messageId?: string; conversationId?: string | null; queuedUntil?: string };

const AUTOMATION_BUDGET_MS = 40_000;
const TOPIC = /^[A-Za-z0-9_.-]{1,64}$/;
// A workflow or AI loop must not flood one customer, or the account with Meta.
export const AUTOMATED_PER_CONTACT = 5;
export const AUTOMATED_PER_MINUTE = 60;

// Templates by default. Free text only goes out with a topic InventiveChat allows, while the customer's 24-hour window
// is open, and after InventiveChat lets automation claim the conversation; its refusals are passed on as they are.
export const sendFromAutomation = async (input: AutomationInput, label = 'Automation'): Promise<AutomationResult> => {
  if (!isUuid(input.personId)) return { success: false, message: 'Give the personId of the contact to message.' };
  const text = cleanText(input.text);
  const topic = typeof input.topic === 'string' && TOPIC.test(input.topic) ? input.topic : null;
  const templateName = isTemplateName(input.templateName) ? input.templateName : null;
  if (!text && !templateName) return { success: false, message: 'Give a templateName, or a text with a topic.' };
  if (text && !topic && !templateName) return { success: false, message: AUTOMATION_NEEDS_TOPIC };
  const settings = await loadSettings();
  const context = await contextFor(settings).catch((error: Error) => error);
  if (context instanceof Error || !settings) return { success: false, message: context instanceof Error ? context.message : 'WhatsApp is not connected.' };
  const person = await getPerson(input.personId);
  if (!person) return { success: false, message: 'No contact has this id.' };
  const phone = primaryPhoneOf(person.phones);
  if (!phone) return { success: false, message: 'This contact has no phone number with a country code.' };
  const recent = await recentAutomatedSends(label, person.id);
  if (recent.toContact >= AUTOMATED_PER_CONTACT) return { success: false, message: `Not sent: automations already sent this contact ${AUTOMATED_PER_CONTACT} WhatsApp messages in the last 10 minutes. Check the workflow for a loop.` };
  if (recent.inLastMinute >= AUTOMATED_PER_MINUTE) return { success: false, message: `Not sent: automations sent ${AUTOMATED_PER_MINUTE} WhatsApp messages in the last minute. Try again in a minute.` };
  const changes = createChangeSet();
  const deadline = Date.now() + AUTOMATION_BUDGET_MS;
  const sender = { kind: 'automation' as const, label };
  try {
    const open = (await conversationsByPhone(phone)).filter((conversation) => !conversation.optedOut && isWindowOpen(conversation.windowExpiresAt)).sort((left, right) => (right.lastInboundAt ?? '').localeCompare(left.lastInboundAt ?? ''))[0];
    if (text && topic && open) {
      const message = await sendToConversation({ context, conversation: open, content: { kind: 'text', text }, sender, topic, deadline, changes });
      return { success: true, message: 'Sent as a reply.', messageId: message.id, conversationId: message.conversationId };
    }
    if (!templateName) return { success: false, message: 'The customer has not written in the last 24 hours, so WhatsApp only allows a template. Give a templateName.' };
    const templates = await withRetry(() => listTemplates(context), deadline);
    const template = findTemplate(templates, templateName, [isLanguageCode(input.languageCode) ? input.languageCode : null, settings.defaultLanguageCode]);
    if (!template) return { success: false, message: `The template ${templateName} is not approved in InventiveChat.` };
    const { parameters, missing } = namedParameters(template, input.parameters);
    if (missing.length) return { success: false, message: `The template ${templateName} needs values for: ${missing.join(', ')}.` };
    const message = await sendTemplateToPerson({ context, settings, person, template: { name: template.name, languageCode: template.language, parameters }, sender, deadline, changes });
    return { success: true, message: `Template ${templateName} sent.`, messageId: message.id, conversationId: message.conversationId };
  } catch (error) {
    if (error instanceof SendDeferred) return { success: true, message: `Queued: ${error.message}`, messageId: error.record.id, queuedUntil: error.retryAt };
    if (error instanceof SendRefused) return { success: false, message: error.message, ...(error.record ? { messageId: error.record.id } : {}) };
    if (error instanceof InventiveChatError) return { success: false, message: describeError(error) };
    throw error;
  } finally {
    await changes.publish();
  }
};
