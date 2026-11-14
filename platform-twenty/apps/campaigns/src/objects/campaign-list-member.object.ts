import { defineObject } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { textField } from 'src/objects/field-builders';

const field = IDS.listMember.fields;

export default defineObject({
  universalIdentifier: IDS.listMember.object,
  nameSingular: 'mailingListMember',
  namePlural: 'mailingListMembers',
  labelSingular: 'List member',
  labelPlural: 'List members',
  description: 'A contact on a mailing list.',
  icon: 'IconUserPlus',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [textField({ universalIdentifier: field.name, name: 'name', label: 'Name', icon: 'IconTag' })],
});
