import { defineObject } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { booleanField, jsonField, textField } from 'src/objects/field-builders';

const field = IDS.bookingLink.fields;

export default defineObject({
  universalIdentifier: IDS.bookingLink.object,
  nameSingular: 'bookingLink',
  namePlural: 'bookingLinks',
  labelSingular: "Booking link",
  labelPlural: "Booking links",
  description: "An extra public link for an appointment type, optionally fixed to an advisor or team with preset values.",
  icon: 'IconLink',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: "Name", icon: 'IconTag' }),
    textField({ universalIdentifier: field.slug, name: 'slug', label: "Slug", icon: 'IconLink', isUnique: true }),
    booleanField({ universalIdentifier: field.isActive, name: 'isActive', label: "Active", icon: 'IconCheck' }, true),
    textField({ universalIdentifier: field.title, name: 'title', label: "Page title", icon: 'IconHeading' }),
    textField({ universalIdentifier: field.description, name: 'description', label: "Page description", icon: 'IconAlignLeft' }),
    jsonField({ universalIdentifier: field.presets, name: 'presets', label: "Preset values", icon: 'IconAdjustments', description: "{\"name\":\"...\",\"email\":\"...\",\"answers\":{\"topic\":\"...\"},\"hide\":[\"topic\"]}" }),
  ],
});
