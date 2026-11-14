import { defineObject } from 'twenty-sdk/define';

import { CHANNEL_KINDS, CHANNEL_VISIBILITIES } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { booleanField, dateTimeField, selectField, textField } from 'src/objects/field-builders';

const field = IDS.channel.fields;

export default defineObject({
  universalIdentifier: IDS.channel.object,
  nameSingular: 'chatChannel',
  namePlural: 'chatChannels',
  labelSingular: 'Chat channel',
  labelPlural: 'Chat channels',
  description: 'A team chat channel or a direct conversation. Messages are only readable in Team chat.',
  icon: 'IconMessages',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: 'Name', icon: 'IconHash' }),
    textField({ universalIdentifier: field.topic, name: 'topic', label: 'Topic', icon: 'IconNote' }),
    selectField({ universalIdentifier: field.kind, name: 'kind', label: 'Kind', icon: 'IconCategory' }, CHANNEL_KINDS, 'CHANNEL'),
    selectField({ universalIdentifier: field.visibility, name: 'visibility', label: 'Who can join', icon: 'IconLock' }, CHANNEL_VISIBILITIES, 'PUBLIC'),
    textField({ universalIdentifier: field.directKey, name: 'directKey', label: 'Direct conversation key', icon: 'IconKey' }),
    dateTimeField({ universalIdentifier: field.lastMessageAt, name: 'lastMessageAt', label: 'Last message', icon: 'IconClock' }),
    booleanField({ universalIdentifier: field.archived, name: 'archived', label: 'Archived', icon: 'IconArchive' }, false),
    textField({ universalIdentifier: field.createdByMemberId, name: 'createdByMemberId', label: 'Created by (member id)', icon: 'IconUser' }),
  ],
});
