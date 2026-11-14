import { defineField, FieldType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.personExtension.fields.whatsappMarketingConsent,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.BOOLEAN,
  name: 'whatsappMarketingConsent',
  label: 'Agreed to marketing on WhatsApp',
  description: 'Only tick this when the contact has actively agreed. Campaigns are never sent to anyone else.',
  icon: 'IconBrandWhatsapp',
  defaultValue: false,
});
