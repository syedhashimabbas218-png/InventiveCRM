import { defineObject } from 'twenty-sdk/define';

import { CAMPAIGN_CHANNELS, SUPPRESSION_REASONS } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { selectField, textField } from 'src/objects/field-builders';

const field = IDS.suppression.fields;

export default defineObject({
  universalIdentifier: IDS.suppression.object,
  nameSingular: 'campaignSuppression',
  namePlural: 'campaignSuppressions',
  labelSingular: 'Do-not-contact entry',
  labelPlural: 'Do-not-contact list',
  description: 'An email address or phone number campaigns never go to.',
  icon: 'IconBan',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: 'Name', icon: 'IconTag' }),
    textField({ universalIdentifier: field.address, name: 'destination', label: 'Email or phone', icon: 'IconAt' }),
    selectField({ universalIdentifier: field.channel, name: 'channel', label: 'Channel', icon: 'IconSend' }, CAMPAIGN_CHANNELS, 'EMAIL'),
    selectField({ universalIdentifier: field.reason, name: 'reason', label: 'Reason', icon: 'IconInfoCircle' }, SUPPRESSION_REASONS, 'UNSUBSCRIBED'),
    textField({ universalIdentifier: field.campaignId, name: 'campaignId', label: 'From campaign', icon: 'IconSpeakerphone' }),
    textField({ universalIdentifier: field.note, name: 'note', label: 'Note', icon: 'IconNote' }),
  ],
});
