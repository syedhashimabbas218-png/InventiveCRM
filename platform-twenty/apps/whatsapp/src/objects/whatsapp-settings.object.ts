import { defineObject } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { booleanField, jsonField, textField } from 'src/objects/field-builders';

const field = IDS.settings.fields;

export default defineObject({
  universalIdentifier: IDS.settings.object,
  nameSingular: 'whatsappSettings',
  namePlural: 'whatsappSettingsRecords',
  labelSingular: 'WhatsApp settings',
  labelPlural: 'WhatsApp settings',
  description: 'The connected InventiveChat account and how WhatsApp works in this workspace. One record.',
  icon: 'IconSettings',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: 'Name', icon: 'IconTag' }),
    textField({ universalIdentifier: field.displayName, name: 'displayName', label: 'WhatsApp business name', icon: 'IconBuildingStore' }),
    textField({ universalIdentifier: field.phoneNumber, name: 'phoneNumber', label: 'WhatsApp number', icon: 'IconPhone' }),
    textField({ universalIdentifier: field.whatsappAccountId, name: 'whatsappAccountId', label: 'WhatsApp number id', icon: 'IconHash', description: 'Which of the account’s numbers sends new conversations.' }),
    textField({ universalIdentifier: field.tenantId, name: 'tenantId', label: 'InventiveChat account', icon: 'IconBuilding' }),
    textField({ universalIdentifier: field.subscriptionId, name: 'subscriptionId', label: 'Webhook id', icon: 'IconWebhook' }),
    textField({ universalIdentifier: field.webhookSecret, name: 'webhookSecret', label: 'Webhook secret (encrypted)', icon: 'IconLock' }),
    textField({ universalIdentifier: field.webhookUrl, name: 'webhookUrl', label: 'Webhook address', icon: 'IconLink' }),
    textField({ universalIdentifier: field.webhookProblem, name: 'webhookProblem', label: 'Connection problem', icon: 'IconAlertTriangle' }),
    textField({ universalIdentifier: field.keyFingerprint, name: 'keyFingerprint', label: 'Key fingerprint', icon: 'IconFingerprint' }),
    booleanField({ universalIdentifier: field.autoCreatePeople, name: 'autoCreatePeople', label: 'Add unknown numbers as people', icon: 'IconUserPlus' }, true),
    jsonField({ universalIdentifier: field.gatewayTemplates, name: 'gatewayTemplates', label: 'Templates for app notifications', icon: 'IconTemplate', description: 'Overrides the default template and parameter mapping for a notification from the other apps. See the WhatsApp app README.' }),
    textField({ universalIdentifier: field.defaultLanguageCode, name: 'defaultLanguageCode', label: 'Template language', icon: 'IconLanguage' }, 'en_GB'),
  ],
});
