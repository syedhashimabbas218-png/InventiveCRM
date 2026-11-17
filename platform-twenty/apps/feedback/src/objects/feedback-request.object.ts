import { defineObject } from 'twenty-sdk/define';

import { CHANNELS, REQUEST_STATUSES, SOURCES } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { booleanField, dateTimeField, numberField, selectField, textField } from 'src/objects/field-builders';

const field = IDS.request.fields;

export default defineObject({
  universalIdentifier: IDS.request.object,
  nameSingular: 'feedbackRequest',
  namePlural: 'feedbackRequests',
  labelSingular: 'Feedback',
  labelPlural: 'Feedback',
  description: 'One request for feedback sent to a customer, and their answer.',
  icon: 'IconMoodSmile',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: 'Name', icon: 'IconTag' }),
    selectField({ universalIdentifier: field.status, name: 'status', label: 'Status', icon: 'IconProgress' }, REQUEST_STATUSES, 'SCHEDULED'),
    numberField({ universalIdentifier: field.score, name: 'score', label: 'Score (0 to 10)', icon: 'IconStar' }, { integer: true }),
    textField({ universalIdentifier: field.comment, name: 'comment', label: 'Comment', icon: 'IconMessage' }),
    selectField({ universalIdentifier: field.channel, name: 'channel', label: 'Sent by', icon: 'IconSend' }, CHANNELS, 'EMAIL'),
    selectField({ universalIdentifier: field.source, name: 'source', label: 'Asked after', icon: 'IconBolt' }, SOURCES, 'MANUAL'),
    textField({ universalIdentifier: field.sourceId, name: 'sourceId', label: 'Source record id', icon: 'IconHash', isUnique: true }),
    textField({ universalIdentifier: field.recipient, name: 'recipient', label: 'Sent to', icon: 'IconAt' }),
    dateTimeField({ universalIdentifier: field.sendAt, name: 'sendAt', label: 'Send at', icon: 'IconCalendarTime' }),
    dateTimeField({ universalIdentifier: field.sentAt, name: 'sentAt', label: 'Sent', icon: 'IconSend' }),
    dateTimeField({ universalIdentifier: field.answeredAt, name: 'answeredAt', label: 'Answered', icon: 'IconCheck' }),
    dateTimeField({ universalIdentifier: field.expiresAt, name: 'expiresAt', label: 'Link expires', icon: 'IconHourglass' }),
    textField({ universalIdentifier: field.nonce, name: 'nonce', label: 'Link key', icon: 'IconKey' }),
    textField({ universalIdentifier: field.error, name: 'error', label: 'Problem', icon: 'IconAlertTriangle' }),
    textField({ universalIdentifier: field.followUpTaskId, name: 'followUpTaskId', label: 'Follow-up task id', icon: 'IconChecklist' }),
    booleanField({ universalIdentifier: field.reviewLinkShown, name: 'reviewLinkShown', label: 'Review link shown', icon: 'IconBrandGoogle' }, false),
    numberField({ universalIdentifier: field.attempts, name: 'attempts', label: 'Send attempts', icon: 'IconRepeat' }, { integer: true, defaultValue: 0 }),
  ],
});
