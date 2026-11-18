import { defineTimelineActivityType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

// Each WhatsApp message linked to a person also shows on that person's timeline, at the time it was sent or received.
export default defineTimelineActivityType({
  universalIdentifier: IDS.timelineActivityTypes.message,
  name: 'whatsappMessage',
  label: 'WhatsApp message',
  icon: 'IconBrandWhatsapp',
  emit: {
    on: 'linked',
    objectUniversalIdentifier: IDS.message.object,
    through: {
      relationFieldUniversalIdentifier: IDS.message.fields.person,
      happensAtFieldUniversalIdentifier: IDS.message.fields.occurredAt,
    },
  },
});
