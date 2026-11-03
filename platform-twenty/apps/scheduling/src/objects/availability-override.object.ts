import { defineObject } from 'twenty-sdk/define';

import { OVERRIDE_KINDS } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { dateField, jsonField, selectField, textField } from 'src/objects/field-builders';

const field = IDS.availabilityOverride.fields;

export default defineObject({
  universalIdentifier: IDS.availabilityOverride.object,
  nameSingular: 'availabilityOverride',
  namePlural: 'availabilityOverrides',
  labelSingular: "Time off or special hours",
  labelPlural: "Time off and special hours",
  description: "Holidays, time off and special-date hours that override the weekly schedule.",
  icon: 'IconCalendarOff',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: "Reason", icon: 'IconTag' }),
    dateField({ universalIdentifier: field.startDate, name: 'startDate', label: "From", icon: 'IconCalendar' }),
    dateField({ universalIdentifier: field.endDate, name: 'endDate', label: "To", icon: 'IconCalendar' }),
    selectField({ universalIdentifier: field.kind, name: 'kind', label: "Kind", icon: 'IconCalendarCog' }, OVERRIDE_KINDS, 'UNAVAILABLE'),
    jsonField({ universalIdentifier: field.windows, name: 'windows', label: "Hours", icon: 'IconClock', description: "For special hours: the windows that apply instead. For time off: leave empty for whole days, or list the hours off." }),
  ],
});
