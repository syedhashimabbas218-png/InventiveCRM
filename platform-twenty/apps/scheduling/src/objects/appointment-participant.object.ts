import { defineObject } from 'twenty-sdk/define';

import { PARTICIPANT_ROLES } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { selectField, textField } from 'src/objects/field-builders';

const field = IDS.appointmentParticipant.fields;

export default defineObject({
  universalIdentifier: IDS.appointmentParticipant.object,
  nameSingular: 'appointmentParticipant',
  namePlural: 'appointmentParticipants',
  labelSingular: "Appointment participant",
  labelPlural: "Appointment participants",
  description: "Advisors taking part in an appointment (the host, and everyone required in a collective meeting).",
  icon: 'IconUsers',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: "Name", icon: 'IconTag' }),
    selectField({ universalIdentifier: field.participantRole, name: 'participantRole', label: "Role", icon: 'IconShield' }, PARTICIPANT_ROLES, 'HOST'),
  ],
});
