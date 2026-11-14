import { defineObject } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { booleanField, dateTimeField, numberField, textField } from 'src/objects/field-builders';

const field = IDS.membership.fields;

export default defineObject({
  universalIdentifier: IDS.membership.object,
  nameSingular: 'chatMembership',
  namePlural: 'chatMemberships',
  labelSingular: 'Chat membership',
  labelPlural: 'Chat memberships',
  description: 'Who is in a chat channel, and what they have read.',
  icon: 'IconUsers',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: 'Name', icon: 'IconTag' }),
    textField({ universalIdentifier: field.workspaceMemberId, name: 'workspaceMemberId', label: 'Member id', icon: 'IconUser' }),
    dateTimeField({ universalIdentifier: field.lastReadAt, name: 'lastReadAt', label: 'Read up to', icon: 'IconEye' }),
    numberField({ universalIdentifier: field.unreadMentions, name: 'unreadMentions', label: 'Unread mentions', icon: 'IconAt' }, { integer: true, defaultValue: 0 }),
    booleanField({ universalIdentifier: field.muted, name: 'muted', label: 'Muted', icon: 'IconBellOff' }, false),
  ],
});
