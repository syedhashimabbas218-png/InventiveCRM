import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.businessProfiles,
  name: 'Business profile',
  objectUniversalIdentifier: IDS.businessProfile.object,
  icon: 'IconBuildingStore',
  position: 0,
  fields: [
    {
      universalIdentifier: '88ce9cce-6a1a-42d0-8d57-650a39e5aa49',
      fieldMetadataUniversalIdentifier: IDS.businessProfile.fields.legalName,
      position: 0,
      isVisible: true,
      size: 240,
    },
    {
      universalIdentifier: 'd09d7ff6-7e89-4c2d-8559-c68a0c020a25',
      fieldMetadataUniversalIdentifier: IDS.businessProfile.fields.vatRegistered,
      position: 1,
      isVisible: true,
      size: 110,
    },
    {
      universalIdentifier: '87af944f-5e90-4984-8586-4186da691a54',
      fieldMetadataUniversalIdentifier: IDS.businessProfile.fields.vatNumber,
      position: 2,
      isVisible: true,
      size: 150,
    },
    {
      universalIdentifier: '7f9dc5b1-9b66-44b0-b4b2-d9ec6bf686e6',
      fieldMetadataUniversalIdentifier: IDS.businessProfile.fields.companyNumber,
      position: 3,
      isVisible: true,
      size: 150,
    },
    {
      universalIdentifier: 'cf4385ba-8df5-4ba4-ba84-2ca677f50902',
      fieldMetadataUniversalIdentifier: IDS.businessProfile.fields.nextInvoiceNumber,
      position: 4,
      isVisible: true,
      size: 140,
    },
  ],
});
