import { defineField, FieldType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

// WhatsApp business messages need the customer's opt-in; nothing is sent by WhatsApp without it.
export default defineField({
  universalIdentifier: IDS.personExtension.fields.whatsappOptIn,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.BOOLEAN,
  name: 'whatsappOptIn',
  label: 'Agreed to WhatsApp messages',
  icon: 'IconBrandWhatsapp',
  defaultValue: false,
});
