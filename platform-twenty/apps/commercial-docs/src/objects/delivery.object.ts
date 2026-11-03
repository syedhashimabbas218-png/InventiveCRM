import { defineObject } from 'twenty-sdk/define';

import { DELIVERY_CHANNELS, DELIVERY_STATUSES } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { dateTimeField, selectField, textField } from 'src/objects/field-builders';

const field = IDS.delivery.fields;

export default defineObject({
  universalIdentifier: IDS.delivery.object,
  nameSingular: 'documentDelivery',
  namePlural: 'documentDeliveries',
  labelSingular: 'Delivery',
  labelPlural: 'Deliveries',
  description: 'Each time a quote or invoice was emailed or sent by WhatsApp, and what happened to it.',
  icon: 'IconSend',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: 'Delivery', icon: 'IconSend' }),
    selectField({ universalIdentifier: field.channel, name: 'channel', label: 'Channel', icon: 'IconMessages' }, DELIVERY_CHANNELS),
    textField({ universalIdentifier: field.method, name: 'method', label: 'Sent via', icon: 'IconServer' }),
    textField({ universalIdentifier: field.recipient, name: 'recipient', label: 'Recipient', icon: 'IconUser' }),
    selectField({ universalIdentifier: field.status, name: 'status', label: 'Status', icon: 'IconProgress' }, DELIVERY_STATUSES, 'QUEUED'),
    dateTimeField({ universalIdentifier: field.sentAt, name: 'sentAt', label: 'Sent at', icon: 'IconClock' }),
    dateTimeField({ universalIdentifier: field.statusUpdatedAt, name: 'statusUpdatedAt', label: 'Status updated', icon: 'IconClockCheck' }),
    textField({ universalIdentifier: field.errorMessage, name: 'errorMessage', label: 'Error', icon: 'IconAlertTriangle' }),
    textField({ universalIdentifier: field.providerMessageId, name: 'providerMessageId', label: 'Provider message id', icon: 'IconHash' }),
  ],
});
