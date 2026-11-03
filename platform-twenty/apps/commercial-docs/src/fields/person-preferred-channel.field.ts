import { defineField, FieldType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';

import { PREFERRED_CHANNELS, selectOptions } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.personExtension.fields.preferredChannel,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.SELECT,
  name: 'preferredChannel',
  label: 'Send documents by',
  icon: 'IconMessages',
  options: selectOptions(PREFERRED_CHANNELS),
  defaultValue: "'EMAIL'",
});
