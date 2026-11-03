import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.appointment.fields.reservations,
  objectUniversalIdentifier: IDS.appointment.object,
  type: FieldType.RELATION,
  name: 'reservations',
  label: "Reservations",
  icon: 'IconLock',
  relationTargetObjectMetadataUniversalIdentifier: IDS.slotReservation.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.slotReservation.fields.appointment,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
