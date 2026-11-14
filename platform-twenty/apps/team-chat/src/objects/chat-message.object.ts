import { defineObject } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { dateTimeField, textField } from 'src/objects/field-builders';

const field = IDS.message.fields;

export default defineObject({
  universalIdentifier: IDS.message.object,
  nameSingular: 'chatMessage',
  namePlural: 'chatMessages',
  labelSingular: 'Chat message',
  labelPlural: 'Chat messages',
  description: 'A team chat message. The text, mentions and linked records are encrypted and only readable in Team chat by people in the channel.',
  icon: 'IconMessage',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: 'Name', icon: 'IconTag' }),
    textField({ universalIdentifier: field.authorMemberId, name: 'authorMemberId', label: 'Author (member id)', icon: 'IconUser' }),
    textField({ universalIdentifier: field.body, name: 'body', label: 'Encrypted text', icon: 'IconLock' }),
    dateTimeField({ universalIdentifier: field.editedAt, name: 'editedAt', label: 'Edited', icon: 'IconPencil' }),
  ],
});
