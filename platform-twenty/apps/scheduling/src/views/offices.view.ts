import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.offices,
  name: "Offices and branches",
  objectUniversalIdentifier: IDS.office.object,
  icon: 'IconBuilding',
  position: 0,
  fields: [
    {
      universalIdentifier: 'c0f6bf1f-485b-4692-9403-bcd5ea6aca89',
      fieldMetadataUniversalIdentifier: IDS.office.fields.name,
      position: 0,
      isVisible: true,
      size: 240,
    },
    {
      universalIdentifier: 'a77c5573-8d1e-4eb5-a7d9-ab799a342bf5',
      fieldMetadataUniversalIdentifier: IDS.office.fields.streetAddress,
      position: 1,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'eded27d8-d9fc-4478-8149-0fc7c9319427',
      fieldMetadataUniversalIdentifier: IDS.office.fields.postcode,
      position: 2,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '0c6a462c-ffd6-4c34-a2d1-47f2363289b9',
      fieldMetadataUniversalIdentifier: IDS.office.fields.timeZone,
      position: 3,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '535bbb34-d4b8-403f-9f38-96b008436561',
      fieldMetadataUniversalIdentifier: IDS.office.fields.isPublic,
      position: 4,
      isVisible: true,
      size: 160,
    },
  ],
});
