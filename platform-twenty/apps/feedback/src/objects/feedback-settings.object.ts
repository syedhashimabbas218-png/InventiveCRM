import { defineObject } from 'twenty-sdk/define';

import { CHANNELS } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { booleanField, dateTimeField, numberField, selectField, textField } from 'src/objects/field-builders';

const field = IDS.settings.fields;

export default defineObject({
  universalIdentifier: IDS.settings.object,
  nameSingular: 'feedbackSettings',
  namePlural: 'feedbackSettingsRecords',
  labelSingular: 'Feedback settings',
  labelPlural: 'Feedback settings',
  description: 'When and how customers are asked for feedback. The oldest record is used.',
  icon: 'IconSettings',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: 'Name', icon: 'IconTag' }),
    textField({ universalIdentifier: field.businessName, name: 'businessName', label: 'Business name shown to customers', icon: 'IconBuildingStore' }),
    booleanField({ universalIdentifier: field.enabled, name: 'enabled', label: 'Ask for feedback automatically', icon: 'IconPlayerPlay' }, false),
    booleanField({ universalIdentifier: field.afterAppointments, name: 'afterAppointments', label: 'After an appointment is completed', icon: 'IconCalendarCheck' }, true),
    booleanField({ universalIdentifier: field.afterPaidInvoices, name: 'afterPaidInvoices', label: 'After an invoice is paid', icon: 'IconReceipt' }, false),
    numberField({ universalIdentifier: field.delayHours, name: 'delayHours', label: 'Hours to wait before asking', icon: 'IconClock' }, { integer: true, defaultValue: 2 }),
    numberField({ universalIdentifier: field.cooldownDays, name: 'cooldownDays', label: 'Ask the same person at most once every (days)', icon: 'IconRepeat' }, { integer: true, defaultValue: 60 }),
    numberField({ universalIdentifier: field.expiryDays, name: 'expiryDays', label: 'Link stays open for (days)', icon: 'IconHourglass' }, { integer: true, defaultValue: 14 }),
    selectField({ universalIdentifier: field.channel, name: 'channel', label: 'Send by', icon: 'IconSend' }, CHANNELS, 'EMAIL'),
    textField({ universalIdentifier: field.question, name: 'question', label: 'Question', icon: 'IconQuestionMark' }, 'How likely are you to recommend us to a friend or colleague?'),
    textField({ universalIdentifier: field.googleReviewUrl, name: 'googleReviewUrl', label: 'Google review link (shown to happy customers)', icon: 'IconBrandGoogle' }),
    numberField({ universalIdentifier: field.promoterScore, name: 'promoterScore', label: 'Show the review link from score', icon: 'IconMoodHappy' }, { integer: true, defaultValue: 9 }),
    numberField({ universalIdentifier: field.alertBelowScore, name: 'alertBelowScore', label: 'Alert the team at or below score', icon: 'IconAlertTriangle' }, { integer: true, defaultValue: 6 }),
    textField({ universalIdentifier: field.alertEmails, name: 'alertEmails', label: 'Alert emails (comma separated)', icon: 'IconMail' }),
    dateTimeField({ universalIdentifier: field.lastScannedAt, name: 'lastScannedAt', label: 'Last checked for new customers', icon: 'IconHistory' }),
  ],
});
