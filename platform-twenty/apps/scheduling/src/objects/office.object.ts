import { defineObject } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { booleanField, numberField, textField } from 'src/objects/field-builders';

const field = IDS.office.fields;

export default defineObject({
  universalIdentifier: IDS.office.object,
  nameSingular: 'office',
  namePlural: 'offices',
  labelSingular: "Office or branch",
  labelPlural: "Offices and branches",
  description: "A physical place where in-person appointments happen.",
  icon: 'IconBuilding',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: "Name", icon: 'IconTag' }),
    textField({ universalIdentifier: field.streetAddress, name: 'streetAddress', label: "Address", icon: 'IconMapPin' }),
    textField({ universalIdentifier: field.postcode, name: 'postcode', label: "Postcode", icon: 'IconMailbox' }),
    numberField({ universalIdentifier: field.latitude, name: 'latitude', label: "Latitude", icon: 'IconMapPin' }, { decimals: 6 }),
    numberField({ universalIdentifier: field.longitude, name: 'longitude', label: "Longitude", icon: 'IconMapPin' }, { decimals: 6 }),
    textField({ universalIdentifier: field.timeZone, name: 'timeZone', label: "Time zone", icon: 'IconWorld' }),
    textField({ universalIdentifier: field.phone, name: 'phone', label: "Phone", icon: 'IconPhone' }),
    booleanField({ universalIdentifier: field.isPublic, name: 'isPublic', label: "Show address to customers", icon: 'IconEye' }, true),
  ],
});
