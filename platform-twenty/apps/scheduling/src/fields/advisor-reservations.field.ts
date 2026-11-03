import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.advisor.fields.reservations,
  objectUniversalIdentifier: IDS.advisor.object,
  type: FieldType.RELATION,
  name: 'reservations',
  label: "Reservations",
  icon: 'IconLock',
  relationTargetObjectMetadataUniversalIdentifier: IDS.slotReservation.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.slotReservation.fields.advisor,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
