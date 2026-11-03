import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.advisors,
  name: "Advisors and locations",
  objectUniversalIdentifier: IDS.advisor.object,
  icon: 'IconUserCircle',
  position: 0,
  fields: [
    {
      universalIdentifier: '20bc9c63-a261-4d70-b815-1632ddc6a00a',
      fieldMetadataUniversalIdentifier: IDS.advisor.fields.name,
      position: 0,
      isVisible: true,
      size: 240,
    },
    {
      universalIdentifier: 'b34d61b8-d147-498c-a34c-cf2a185f1f0b',
      fieldMetadataUniversalIdentifier: IDS.advisor.fields.isActive,
      position: 1,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '6b0798b4-e37f-45bd-b777-9ecbbb618ab0',
      fieldMetadataUniversalIdentifier: IDS.advisor.fields.email,
      position: 2,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '7a15841d-0a7c-43c8-bd36-29313900afcb',
      fieldMetadataUniversalIdentifier: IDS.advisor.fields.timeZone,
      position: 3,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '8d560d01-0159-4088-a2ac-b6d276e29f1c',
      fieldMetadataUniversalIdentifier: IDS.advisor.fields.office,
      position: 4,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'd9e049e3-ca9c-406a-95cb-2ee33a888635',
      fieldMetadataUniversalIdentifier: IDS.advisor.fields.publicLocationLabel,
      position: 5,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'de41e296-dc29-423f-8730-c16e13e594fa',
      fieldMetadataUniversalIdentifier: IDS.advisor.fields.serviceRadiusKm,
      position: 6,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'ebda47a9-f4f2-49bd-9cb6-48dde76148d1',
      fieldMetadataUniversalIdentifier: IDS.advisor.fields.travelsToCustomers,
      position: 7,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'e22cb5c1-fa43-4eed-a69c-5bc12d662949',
      fieldMetadataUniversalIdentifier: IDS.advisor.fields.postcodeTerritory,
      position: 8,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '5187f990-ad3f-4c99-aaa6-796eea787def',
      fieldMetadataUniversalIdentifier: IDS.advisor.fields.weight,
      position: 9,
      isVisible: true,
      size: 160,
    },
  ],
});
