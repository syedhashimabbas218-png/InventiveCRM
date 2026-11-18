import { defineObject } from 'twenty-sdk/define';

import { MESSAGE_DIRECTIONS, MESSAGE_STATUSES, MESSAGE_TYPES } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { dateTimeField, jsonField, selectField, textField } from 'src/objects/field-builders';

const field = IDS.message.fields;

export default defineObject({
  universalIdentifier: IDS.message.object,
  nameSingular: 'whatsappMessage',
  namePlural: 'whatsappMessages',
  labelSingular: 'WhatsApp message',
  labelPlural: 'WhatsApp messages',
  description: 'One WhatsApp message to or from a customer. Workflows can start when one is created.',
  icon: 'IconMessageCircle',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: 'Message', icon: 'IconMessage' }),
    selectField({ universalIdentifier: field.direction, name: 'direction', label: 'Direction', icon: 'IconArrowsExchange' }, MESSAGE_DIRECTIONS),
    selectField({ universalIdentifier: field.messageType, name: 'messageType', label: 'Kind', icon: 'IconCategory' }, MESSAGE_TYPES, 'TEXT'),
    textField({ universalIdentifier: field.text, name: 'text', label: 'Text', icon: 'IconAlignLeft' }),
    textField({ universalIdentifier: field.templateName, name: 'templateName', label: 'Template', icon: 'IconTemplate' }),
    textField({ universalIdentifier: field.mediaKind, name: 'mediaKind', label: 'Attachment kind', icon: 'IconPaperclip' }),
    textField({ universalIdentifier: field.attachmentId, name: 'attachmentId', label: 'Attachment id', icon: 'IconHash' }),
    textField({ universalIdentifier: field.mediaFilename, name: 'mediaFilename', label: 'Attachment name', icon: 'IconFile' }),
    selectField({ universalIdentifier: field.status, name: 'status', label: 'Status', icon: 'IconChecks' }, MESSAGE_STATUSES),
    textField({ universalIdentifier: field.error, name: 'error', label: 'Problem', icon: 'IconAlertTriangle' }),
    textField({ universalIdentifier: field.sentByName, name: 'sentByName', label: 'Sent by (name)', icon: 'IconUser' }),
    dateTimeField({ universalIdentifier: field.occurredAt, name: 'occurredAt', label: 'Time', icon: 'IconClock' }),
    textField({ universalIdentifier: field.inventiveChatMessageId, name: 'inventiveChatMessageId', label: 'InventiveChat id', icon: 'IconHash', isUnique: true }),
    textField({ universalIdentifier: field.idempotencyKey, name: 'idempotencyKey', label: 'Send key', icon: 'IconKey' }),
    textField({ universalIdentifier: field.deliveryId, name: 'deliveryId', label: 'Gateway delivery', icon: 'IconSend', isUnique: true }),
    textField({ universalIdentifier: field.gatewayEvent, name: 'gatewayEvent', label: 'Gateway event', icon: 'IconBolt' }),
    textField({ universalIdentifier: field.batchId, name: 'batchId', label: 'Campaign batch', icon: 'IconStack' }),
    textField({ universalIdentifier: field.statusCallbackUrl, name: 'statusCallbackUrl', label: 'Status callback', icon: 'IconLink' }),
    dateTimeField({ universalIdentifier: field.retryAt, name: 'retryAt', label: 'Send again at', icon: 'IconClockPlay', description: 'Set while WhatsApp asks to wait, for example while a teammate is chatting with the customer.' }),
    jsonField({ universalIdentifier: field.sendPayload, name: 'sendPayload', label: 'What to send', icon: 'IconBraces' }),
    textField({ universalIdentifier: field.waitingFor, name: 'waitingFor', label: 'Waiting for', icon: 'IconHourglassHigh', description: 'person (a teammate is chatting), meta (Meta’s limit) or busy.' }),
    textField({ universalIdentifier: field.recipientPhone, name: 'recipientPhone', label: 'To', icon: 'IconPhone' }),
  ],
});
