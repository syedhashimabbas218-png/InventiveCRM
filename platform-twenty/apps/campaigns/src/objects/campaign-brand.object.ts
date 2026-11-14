import { defineObject } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { dateTimeField, jsonField, numberField, selectField, textField } from 'src/objects/field-builders';

const field = IDS.brand.fields;

export default defineObject({
  universalIdentifier: IDS.brand.object,
  nameSingular: 'campaignBrand',
  namePlural: 'campaignBrands',
  labelSingular: 'Brand kit',
  labelPlural: 'Brand kits',
  description: 'Logo, colours and the footer every campaign email carries. The oldest record is used.',
  icon: 'IconPalette',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: 'Name', icon: 'IconTag' }),
    textField({ universalIdentifier: field.logoUrl, name: 'logoUrl', label: 'Logo image link (https)', icon: 'IconPhoto' }),
    textField({ universalIdentifier: field.primaryColor, name: 'primaryColor', label: 'Main colour', icon: 'IconColorSwatch' }, '#3e63dd'),
    textField({ universalIdentifier: field.backgroundColor, name: 'backgroundColor', label: 'Background colour', icon: 'IconColorSwatch' }, '#f1f1f1'),
    textField({ universalIdentifier: field.textColor, name: 'textColor', label: 'Text colour', icon: 'IconColorSwatch' }, '#333333'),
    textField({ universalIdentifier: field.fontFamily, name: 'fontFamily', label: 'Font', icon: 'IconTypography' }, 'Arial, Helvetica, sans-serif'),
    textField({ universalIdentifier: field.footerText, name: 'footerText', label: 'Footer (business name and postal address)', icon: 'IconAddressBook' }),
    textField({ universalIdentifier: field.websiteUrl, name: 'websiteUrl', label: 'Website', icon: 'IconWorld' }),
  ],
});
