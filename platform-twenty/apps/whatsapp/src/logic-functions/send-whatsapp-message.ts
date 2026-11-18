import { defineLogicFunction } from 'twenty-sdk/define';
import { jsonSchemaToInputSchema } from 'twenty-sdk/logic-function';

import { IDS } from 'src/constants/ids';
import { asApplication } from 'src/lib/api';
import { type AutomationInput, sendFromAutomation } from 'src/lib/automation';

const inputSchema = {
  type: 'object',
  properties: {
    personId: { type: 'string', description: 'Id of the contact (person) to message on WhatsApp.' },
    templateName: { type: 'string', description: 'Approved WhatsApp template. Needed unless a free-text reply is allowed (see text and topic).' },
    parameters: { type: 'object', description: 'Values for the template parameters by name, for example { "customer_name": "Ann" }.' },
    languageCode: { type: 'string', description: 'Template language, for example en_GB. Defaults to the language in WhatsApp settings.' },
    text: { type: 'string', description: 'Free text, sent only with a topic, while the contact wrote in the last 24 hours and InventiveChat lets automation answer them.' },
    topic: { type: 'string', description: 'Topic InventiveChat allows for automated replies; required for free text.' },
  },
  required: ['personId'] as string[],
} as const;

const handler = async (event: AutomationInput & { body?: AutomationInput | null }) => asApplication(() => sendFromAutomation(event.body ?? event));

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.sendMessageTool,
  name: 'send-whatsapp-message',
  description: 'Send a WhatsApp message to a contact: an approved template, or free text on an allowed topic while they are in their 24-hour window. Logged in the contact’s WhatsApp conversation.',
  timeoutSeconds: 60,
  toolTriggerSettings: { inputSchema },
  workflowActionTriggerSettings: {
    label: 'Send WhatsApp message',
    icon: 'IconBrandWhatsapp',
    inputSchema: jsonSchemaToInputSchema(inputSchema),
    outputSchema: [{ type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' }, messageId: { type: 'string' } } }],
  },
  handler,
});
