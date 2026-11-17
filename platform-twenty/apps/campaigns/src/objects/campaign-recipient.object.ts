import { defineObject } from 'twenty-sdk/define';

import { RECIPIENT_STATUSES } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { dateTimeField, jsonField, selectField, textField } from 'src/objects/field-builders';

const field = IDS.recipient.fields;

export default defineObject({
  universalIdentifier: IDS.recipient.object,
  nameSingular: 'campaignRecipient',
  namePlural: 'campaignRecipients',
  labelSingular: 'Campaign recipient',
  labelPlural: 'Campaign recipients',
  description: 'One person a campaign was sent to, and what happened.',
  icon: 'IconUserCheck',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: 'Name', icon: 'IconTag' }),
    textField({ universalIdentifier: field.address, name: 'destination', label: 'Sent to', icon: 'IconAt' }),
    selectField({ universalIdentifier: field.status, name: 'status', label: 'Status', icon: 'IconProgress' }, RECIPIENT_STATUSES, 'QUEUED'),
    textField({ universalIdentifier: field.providerMessageId, name: 'providerMessageId', label: 'Provider message id', icon: 'IconHash' }),
    textField({ universalIdentifier: field.error, name: 'error', label: 'Problem', icon: 'IconAlertTriangle' }),
    textField({ universalIdentifier: field.batchKey, name: 'batchKey', label: 'Batch', icon: 'IconStack' }),
    textField({ universalIdentifier: field.nonce, name: 'nonce', label: 'Link key', icon: 'IconKey' }),
    dateTimeField({ universalIdentifier: field.sentAt, name: 'sentAt', label: 'Sent', icon: 'IconSend' }),
    dateTimeField({ universalIdentifier: field.deliveredAt, name: 'deliveredAt', label: 'Delivered', icon: 'IconMailCheck' }),
    dateTimeField({ universalIdentifier: field.openedAt, name: 'openedAt', label: 'Opened', icon: 'IconMailOpened' }),
    dateTimeField({ universalIdentifier: field.clickedAt, name: 'clickedAt', label: 'Clicked', icon: 'IconClick' }),
    dateTimeField({ universalIdentifier: field.bouncedAt, name: 'bouncedAt', label: 'Bounced', icon: 'IconMailOff' }),
    dateTimeField({ universalIdentifier: field.complainedAt, name: 'complainedAt', label: 'Marked as spam', icon: 'IconAlertTriangle' }),
    dateTimeField({ universalIdentifier: field.unsubscribedAt, name: 'unsubscribedAt', label: 'Unsubscribed', icon: 'IconUserMinus' }),
    jsonField({ universalIdentifier: field.personalisation, name: 'personalisation', label: 'Personalisation', icon: 'IconBraces', description: 'Name and company as they were when the audience was prepared.' }),
  ],
});
