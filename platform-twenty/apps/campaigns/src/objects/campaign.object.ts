import { defineObject } from 'twenty-sdk/define';

import { CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { dateTimeField, jsonField, numberField, selectField, textField } from 'src/objects/field-builders';

const field = IDS.campaign.fields;

export default defineObject({
  universalIdentifier: IDS.campaign.object,
  nameSingular: 'marketingCampaign',
  namePlural: 'marketingCampaigns',
  labelSingular: 'Campaign',
  labelPlural: 'Campaigns',
  description: 'An email or WhatsApp campaign sent to a list.',
  icon: 'IconSpeakerphone',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: 'Name', icon: 'IconTag' }),
    selectField({ universalIdentifier: field.channel, name: 'channel', label: 'Channel', icon: 'IconSend' }, CAMPAIGN_CHANNELS, 'EMAIL'),
    selectField({ universalIdentifier: field.status, name: 'status', label: 'Status', icon: 'IconProgress' }, CAMPAIGN_STATUSES, 'DRAFT'),
    textField({ universalIdentifier: field.subject, name: 'subject', label: 'Subject', icon: 'IconMail' }),
    textField({ universalIdentifier: field.previewText, name: 'previewText', label: 'Preview text', icon: 'IconEye' }),
    textField({ universalIdentifier: field.fromName, name: 'fromName', label: 'From name', icon: 'IconUser' }),
    textField({ universalIdentifier: field.fromLocalPart, name: 'fromLocalPart', label: 'From address (before @)', icon: 'IconAt' }),
    textField({ universalIdentifier: field.fromDomain, name: 'fromDomain', label: 'Sending domain', icon: 'IconWorld' }),
    textField({ universalIdentifier: field.replyTo, name: 'replyTo', label: 'Reply-to address', icon: 'IconArrowBackUp' }),
    textField({ universalIdentifier: field.listId, name: 'listId', label: 'List id', icon: 'IconList' }),
    textField({ universalIdentifier: field.listName, name: 'listName', label: 'List', icon: 'IconList' }),
    jsonField({ universalIdentifier: field.design, name: 'design', label: 'Design', icon: 'IconLayout' }),
    dateTimeField({ universalIdentifier: field.scheduledAt, name: 'scheduledAt', label: 'Scheduled for', icon: 'IconCalendarTime' }),
    dateTimeField({ universalIdentifier: field.startedAt, name: 'startedAt', label: 'Started', icon: 'IconPlayerPlay' }),
    dateTimeField({ universalIdentifier: field.sentAt, name: 'sentAt', label: 'Finished', icon: 'IconCheck' }),
    numberField({ universalIdentifier: field.recipientCount, name: 'recipientCount', label: 'Recipients', icon: 'IconUsers' }, { integer: true, defaultValue: 0 }),
    numberField({ universalIdentifier: field.sentCount, name: 'sentCount', label: 'Sent', icon: 'IconSend' }, { integer: true, defaultValue: 0 }),
    numberField({ universalIdentifier: field.deliveredCount, name: 'deliveredCount', label: 'Delivered', icon: 'IconMailCheck' }, { integer: true, defaultValue: 0 }),
    numberField({ universalIdentifier: field.openedCount, name: 'openedCount', label: 'Opened', icon: 'IconMailOpened' }, { integer: true, defaultValue: 0 }),
    numberField({ universalIdentifier: field.clickedCount, name: 'clickedCount', label: 'Clicked', icon: 'IconClick' }, { integer: true, defaultValue: 0 }),
    numberField({ universalIdentifier: field.bouncedCount, name: 'bouncedCount', label: 'Bounced', icon: 'IconMailOff' }, { integer: true, defaultValue: 0 }),
    numberField({ universalIdentifier: field.complainedCount, name: 'complainedCount', label: 'Marked as spam', icon: 'IconAlertTriangle' }, { integer: true, defaultValue: 0 }),
    numberField({ universalIdentifier: field.unsubscribedCount, name: 'unsubscribedCount', label: 'Unsubscribed', icon: 'IconUserMinus' }, { integer: true, defaultValue: 0 }),
    numberField({ universalIdentifier: field.failedCount, name: 'failedCount', label: 'Failed', icon: 'IconX' }, { integer: true, defaultValue: 0 }),
    numberField({ universalIdentifier: field.skippedCount, name: 'skippedCount', label: 'Skipped', icon: 'IconPlayerSkipForward' }, { integer: true, defaultValue: 0 }),
    textField({ universalIdentifier: field.whatsappTemplate, name: 'whatsappTemplate', label: 'WhatsApp template', icon: 'IconBrandWhatsapp' }),
    jsonField({ universalIdentifier: field.whatsappVariables, name: 'whatsappVariables', label: 'WhatsApp template values', icon: 'IconBraces' }),
    dateTimeField({ universalIdentifier: field.lockedUntil, name: 'lockedUntil', label: 'Being worked on until', icon: 'IconLock' }),
    textField({ universalIdentifier: field.prepareCursor, name: 'prepareCursor', label: 'Preparation progress', icon: 'IconProgress' }),
    textField({ universalIdentifier: field.lastError, name: 'lastError', label: 'Problem', icon: 'IconAlertTriangle' }),
  ],
});
