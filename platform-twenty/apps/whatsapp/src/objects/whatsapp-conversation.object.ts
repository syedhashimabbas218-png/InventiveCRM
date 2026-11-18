import { defineObject } from 'twenty-sdk/define';

import { CONVERSATION_HANDLING, CONVERSATION_STATUSES } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { booleanField, dateTimeField, numberField, selectField, textField } from 'src/objects/field-builders';

const field = IDS.conversation.fields;

export default defineObject({
  universalIdentifier: IDS.conversation.object,
  nameSingular: 'whatsappConversation',
  namePlural: 'whatsappConversations',
  labelSingular: 'WhatsApp conversation',
  labelPlural: 'WhatsApp conversations',
  description: 'A WhatsApp conversation with a customer, mirrored from InventiveChat.',
  icon: 'IconBrandWhatsapp',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: 'Customer', icon: 'IconUser' }),
    textField({ universalIdentifier: field.customerPhone, name: 'customerPhone', label: 'Phone', icon: 'IconPhone', description: 'International format, for example +447700900123.' }),
    textField({ universalIdentifier: field.waId, name: 'waId', label: 'WhatsApp id', icon: 'IconId' }),
    textField({ universalIdentifier: field.profileName, name: 'profileName', label: 'WhatsApp name', icon: 'IconUserCircle' }),
    selectField({ universalIdentifier: field.status, name: 'status', label: 'Status', icon: 'IconProgress' }, CONVERSATION_STATUSES, 'OPEN'),
    selectField({ universalIdentifier: field.handling, name: 'handling', label: 'Handled by', icon: 'IconRobot', description: 'Who InventiveChat says is answering: its AI or a person.' }, CONVERSATION_HANDLING),
    dateTimeField({ universalIdentifier: field.lastMessageAt, name: 'lastMessageAt', label: 'Last message', icon: 'IconClock' }),
    textField({ universalIdentifier: field.lastMessagePreview, name: 'lastMessagePreview', label: 'Last message text', icon: 'IconMessage' }),
    dateTimeField({ universalIdentifier: field.lastInboundAt, name: 'lastInboundAt', label: 'Customer last wrote', icon: 'IconMessageDown' }),
    dateTimeField({ universalIdentifier: field.lastReadAt, name: 'lastReadAt', label: 'Read up to', icon: 'IconEye' }),
    numberField({ universalIdentifier: field.unreadCount, name: 'unreadCount', label: 'Unread', icon: 'IconBell' }, { integer: true, defaultValue: 0 }),
    dateTimeField({ universalIdentifier: field.windowExpiresAt, name: 'windowExpiresAt', label: 'Free replies until', icon: 'IconHourglass', description: 'Free text can be sent until 24 hours after the customer last wrote; after that only templates.' }),
    booleanField({ universalIdentifier: field.optedOut, name: 'optedOut', label: 'Opted out', icon: 'IconBan' }, false),
    booleanField({ universalIdentifier: field.customerWaiting, name: 'customerWaiting', label: 'Waiting for us', icon: 'IconHourglassHigh' }, false),
    dateTimeField({ universalIdentifier: field.aiPausedUntil, name: 'aiPausedUntil', label: 'AI paused until', icon: 'IconPlayerPause' }),
    dateTimeField({ universalIdentifier: field.stateEventAt, name: 'stateEventAt', label: 'Handling as of', icon: 'IconClockCheck', description: 'When InventiveChat reported who is handling this conversation; older reports that arrive late are ignored.' }),
    dateTimeField({ universalIdentifier: field.consentEventAt, name: 'consentEventAt', label: 'Consent as of', icon: 'IconClockCheck', description: 'When InventiveChat last reported an opt-out or consent change for this customer; older reports that arrive late are ignored.' }),
    textField({ universalIdentifier: field.inventiveChatConversationId, name: 'inventiveChatConversationId', label: 'InventiveChat id', icon: 'IconHash', isUnique: true }),
  ],
});
