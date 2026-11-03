import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.products,
  name: 'Price list',
  objectUniversalIdentifier: IDS.product.object,
  icon: 'IconPackage',
  position: 0,
  fields: [
    {
      universalIdentifier: 'b7563e27-1bb8-4eab-b9d4-b8e4bd986bdc',
      fieldMetadataUniversalIdentifier: IDS.product.fields.name,
      position: 0,
      isVisible: true,
      size: 240,
    },
    {
      universalIdentifier: 'c1d85386-399a-44d3-9627-235d0f7d7d31',
      fieldMetadataUniversalIdentifier: IDS.product.fields.unitPrice,
      position: 1,
      isVisible: true,
      size: 130,
    },
    {
      universalIdentifier: 'c99ab04d-65f4-46b8-bd34-0c8f18466a59',
      fieldMetadataUniversalIdentifier: IDS.product.fields.vatRate,
      position: 2,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '8cd497ec-6349-417a-8fc8-a1c6160d5307',
      fieldMetadataUniversalIdentifier: IDS.product.fields.unit,
      position: 3,
      isVisible: true,
      size: 100,
    },
    {
      universalIdentifier: 'dd5117eb-5e35-4c13-834a-3fa16ee1ec40',
      fieldMetadataUniversalIdentifier: IDS.product.fields.isActive,
      position: 4,
      isVisible: true,
      size: 90,
    },
  ],
});
