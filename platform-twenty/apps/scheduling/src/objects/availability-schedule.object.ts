import { defineObject } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { booleanField, jsonField, textField } from 'src/objects/field-builders';

const field = IDS.availabilitySchedule.fields;

export default defineObject({
  universalIdentifier: IDS.availabilitySchedule.object,
  nameSingular: 'availabilitySchedule',
  namePlural: 'availabilitySchedules',
  labelSingular: "Availability schedule",
  labelPlural: "Availability schedules",
  description: "Weekly working hours in a time zone. Several windows per day are allowed (gaps are breaks).",
  icon: 'IconCalendarTime',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: "Name", icon: 'IconTag' }),
    textField({ universalIdentifier: field.timeZone, name: 'timeZone', label: "Time zone", icon: 'IconWorld' }),
    jsonField({ universalIdentifier: field.weeklyHours, name: 'weeklyHours', label: "Weekly hours", icon: 'IconCalendarWeek', description: "{\"mon\":[{\"start\":\"09:00\",\"end\":\"12:30\"},{\"start\":\"13:30\",\"end\":\"17:00\"}],...}; an end at or before the start runs past midnight." }),
    booleanField({ universalIdentifier: field.isDefault, name: 'isDefault', label: "Default for the advisor", icon: 'IconStar' }, true),
  ],
});
