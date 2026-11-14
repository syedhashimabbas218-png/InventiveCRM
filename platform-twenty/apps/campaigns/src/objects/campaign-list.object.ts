import { defineObject } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { numberField, textField } from 'src/objects/field-builders';

const field = IDS.list.fields;

export default defineObject({
  universalIdentifier: IDS.list.object,
  nameSingular: 'mailingList',
  namePlural: 'mailingLists',
  labelSingular: 'Mailing list',
  labelPlural: 'Mailing lists',
  description: 'A group of contacts a campaign can be sent to.',
  icon: 'IconList',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: 'Name', icon: 'IconTag' }),
    textField({ universalIdentifier: field.description, name: 'description', label: 'Description', icon: 'IconNote' }),
    numberField({ universalIdentifier: field.memberCount, name: 'memberCount', label: 'Contacts', icon: 'IconUsers' }, { integer: true, defaultValue: 0 }),
  ],
});
