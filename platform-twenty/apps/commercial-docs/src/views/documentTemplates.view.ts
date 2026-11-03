import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.documentTemplates,
  name: 'Document templates',
  objectUniversalIdentifier: IDS.documentTemplate.object,
  icon: 'IconTemplate',
  position: 0,
  fields: [
    {
      universalIdentifier: '21f054fe-959a-4c1d-b9b9-0b99fdc53eeb',
      fieldMetadataUniversalIdentifier: IDS.documentTemplate.fields.name,
      position: 0,
      isVisible: true,
      size: 240,
    },
    {
      universalIdentifier: '7bb53980-68dc-4b35-bd9a-032f528cc08d',
      fieldMetadataUniversalIdentifier: IDS.documentTemplate.fields.status,
      position: 1,
      isVisible: true,
      size: 140,
    },
    {
      universalIdentifier: '246c15dd-a797-4d25-9ab0-4c1acd8a4418',
      fieldMetadataUniversalIdentifier: IDS.documentTemplate.fields.documentType,
      position: 2,
      isVisible: true,
      size: 140,
    },
    {
      universalIdentifier: 'ab11129f-6cab-4f8a-b9cc-77bb728072a3',
      fieldMetadataUniversalIdentifier: IDS.documentTemplate.fields.vatScheme,
      position: 3,
      isVisible: true,
      size: 170,
    },
    {
      universalIdentifier: '24474cd7-e63b-4c1d-85d1-cd1e0c1a7317',
      fieldMetadataUniversalIdentifier: IDS.documentTemplate.fields.company,
      position: 4,
      isVisible: true,
      size: 180,
    },
    {
      universalIdentifier: '59c68f2a-29d7-4d55-8292-83843e9bd5a9',
      fieldMetadataUniversalIdentifier: IDS.documentTemplate.fields.priority,
      position: 5,
      isVisible: true,
      size: 90,
    },
    {
      universalIdentifier: '7c97f762-80fa-47e7-986d-3d8333fc5d02',
      fieldMetadataUniversalIdentifier: IDS.documentTemplate.fields.format,
      position: 6,
      isVisible: true,
      size: 200,
    },
    {
      universalIdentifier: 'a641f11c-786a-4385-87fb-7b9ea186d4ac',
      fieldMetadataUniversalIdentifier: IDS.documentTemplate.fields.isActive,
      position: 7,
      isVisible: true,
      size: 80,
    },
  ],
});
