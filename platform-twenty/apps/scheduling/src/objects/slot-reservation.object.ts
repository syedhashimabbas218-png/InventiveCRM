import { defineObject } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { dateTimeField, textField } from 'src/objects/field-builders';

const field = IDS.slotReservation.fields;

export default defineObject({
  universalIdentifier: IDS.slotReservation.object,
  nameSingular: 'slotReservation',
  namePlural: 'slotReservations',
  labelSingular: "Slot reservation",
  labelPlural: "Slot reservations",
  description: "One row per advisor per 5 minutes an appointment holds. The unique key makes double booking impossible.",
  icon: 'IconLock',
  labelIdentifierFieldMetadataUniversalIdentifier: field.key,
  fields: [
    textField({ universalIdentifier: field.key, name: 'key', label: "Key", icon: 'IconKey', isUnique: true }),
    dateTimeField({ universalIdentifier: field.startsAt, name: 'startsAt', label: "Tick", icon: 'IconClock' }),
  ],
});
