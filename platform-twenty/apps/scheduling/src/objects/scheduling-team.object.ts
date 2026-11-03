import { defineObject } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { booleanField, numberField, textField } from 'src/objects/field-builders';

const field = IDS.schedulingTeam.fields;

export default defineObject({
  universalIdentifier: IDS.schedulingTeam.object,
  nameSingular: 'schedulingTeam',
  namePlural: 'schedulingTeams',
  labelSingular: "Scheduling team",
  labelPlural: "Scheduling teams",
  description: "A group of advisors that shares appointment types, booking pages and round-robin distribution.",
  icon: 'IconUsersGroup',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: "Name", icon: 'IconTag' }),
    textField({ universalIdentifier: field.slug, name: 'slug', label: "Booking slug", icon: 'IconLink', isUnique: true }),
    textField({ universalIdentifier: field.description, name: 'description', label: "Description", icon: 'IconAlignLeft' }),
    booleanField({ universalIdentifier: field.isActive, name: 'isActive', label: "Active", icon: 'IconCheck' }, true),
    numberField({ universalIdentifier: field.fairnessWindowDays, name: 'fairnessWindowDays', label: "Fairness window (days)", icon: 'IconScale', description: "Bookings in this many past days count towards round-robin fairness." }, { integer: true, defaultValue: 30 }),
  ],
});
