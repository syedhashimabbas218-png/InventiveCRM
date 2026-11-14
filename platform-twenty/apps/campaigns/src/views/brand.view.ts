import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.brand,
  name: 'Brand kit',
  objectUniversalIdentifier: IDS.brand.object,
  icon: 'IconPalette',
  position: 0,
  fields: [
    { universalIdentifier: '7c7e1a4c-c4a4-4c39-b1d2-b8e8cfcfd3c0', fieldMetadataUniversalIdentifier: IDS.brand.fields.name, position: 0, isVisible: true, size: 200 },
    { universalIdentifier: '630a13d1-d9b6-4a87-822b-d4195e5a3768', fieldMetadataUniversalIdentifier: IDS.brand.fields.primaryColor, position: 1, isVisible: true, size: 130 },
    { universalIdentifier: 'c45a7676-cd7c-4cab-a837-0b246196bf32', fieldMetadataUniversalIdentifier: IDS.brand.fields.fontFamily, position: 2, isVisible: true, size: 200 },
    { universalIdentifier: 'b70a9c5f-020a-4cea-b016-f59f8ef535a8', fieldMetadataUniversalIdentifier: IDS.brand.fields.footerText, position: 3, isVisible: true, size: 320 },
    { universalIdentifier: '8b66fcdb-fcc4-468e-88bf-4fd07f5b2dee', fieldMetadataUniversalIdentifier: IDS.brand.fields.websiteUrl, position: 4, isVisible: true, size: 200 },
  ],
});
