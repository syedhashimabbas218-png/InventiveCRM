import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.quotes,
  name: 'All quotes',
  objectUniversalIdentifier: IDS.quote.object,
  icon: 'IconFileDescription',
  position: 0,
  fields: [
    {
      universalIdentifier: 'f24e342c-2c3f-4959-8432-1c844efbff52',
      fieldMetadataUniversalIdentifier: IDS.quote.fields.name,
      position: 0,
      isVisible: true,
      size: 260,
    },
    {
      universalIdentifier: '9a06fb17-1afd-4965-bf68-1970cfe90b1c',
      fieldMetadataUniversalIdentifier: IDS.quote.fields.status,
      position: 1,
      isVisible: true,
      size: 130,
    },
    {
      universalIdentifier: 'c81768f8-9d9b-4445-b736-43950d20b12a',
      fieldMetadataUniversalIdentifier: IDS.quote.fields.company,
      position: 2,
      isVisible: true,
      size: 200,
    },
    {
      universalIdentifier: '7f1d7c63-224e-4f81-87a7-25a27862f22d',
      fieldMetadataUniversalIdentifier: IDS.quote.fields.total,
      position: 3,
      isVisible: true,
      size: 120,
    },
    {
      universalIdentifier: '9f724ff6-c478-4167-a8e4-da82e511558e',
      fieldMetadataUniversalIdentifier: IDS.quote.fields.validUntil,
      position: 4,
      isVisible: true,
      size: 120,
    },
    {
      universalIdentifier: 'fceb570f-d122-4c9a-b9a3-15f1f4424063',
      fieldMetadataUniversalIdentifier: IDS.quote.fields.issueDate,
      position: 5,
      isVisible: true,
      size: 120,
    },
  ],
});
