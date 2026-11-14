import { defineField, FieldType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.personExtension.fields.emailMarketingConsent,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.BOOLEAN,
  name: 'emailMarketingConsent',
  label: 'Agreed to marketing emails',
  description: 'Only tick this when the contact has actively agreed. Campaigns are never sent to anyone else.',
  icon: 'IconMailCheck',
  defaultValue: false,
});
