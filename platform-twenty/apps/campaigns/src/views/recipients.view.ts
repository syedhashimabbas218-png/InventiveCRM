import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.recipients,
  name: 'All recipients',
  objectUniversalIdentifier: IDS.recipient.object,
  icon: 'IconUserCheck',
  position: 0,
  fields: [
    { universalIdentifier: 'eb2d2029-57c4-43b0-bd2a-d0b489929a17', fieldMetadataUniversalIdentifier: IDS.recipient.fields.name, position: 0, isVisible: true, size: 200 },
    { universalIdentifier: 'd0b70913-3922-4a2e-b0e3-21a5b81a7dbf', fieldMetadataUniversalIdentifier: IDS.recipient.fields.campaign, position: 1, isVisible: true, size: 200 },
    { universalIdentifier: '0655960e-59dc-4f4d-bc97-6d10e4ac7736', fieldMetadataUniversalIdentifier: IDS.recipient.fields.address, position: 2, isVisible: true, size: 220 },
    { universalIdentifier: 'e9c81ac6-7985-413e-aa0e-cb2cc4a6abbc', fieldMetadataUniversalIdentifier: IDS.recipient.fields.status, position: 3, isVisible: true, size: 130 },
    { universalIdentifier: '96af5ca6-f282-4e9a-b447-316f29761c40', fieldMetadataUniversalIdentifier: IDS.recipient.fields.sentAt, position: 4, isVisible: true, size: 160 },
    { universalIdentifier: '3b6dae99-34df-43ae-91a2-37dcc7133dd5', fieldMetadataUniversalIdentifier: IDS.recipient.fields.deliveredAt, position: 5, isVisible: true, size: 160 },
    { universalIdentifier: '337b4822-f40b-4062-ab6c-54d16b1cfb00', fieldMetadataUniversalIdentifier: IDS.recipient.fields.openedAt, position: 6, isVisible: true, size: 160 },
    { universalIdentifier: 'c3fb13a5-51ea-4ce6-92b1-1904b8d75b0c', fieldMetadataUniversalIdentifier: IDS.recipient.fields.clickedAt, position: 7, isVisible: true, size: 160 },
    { universalIdentifier: 'a05e70af-9817-4b26-aa48-65daeda67e73', fieldMetadataUniversalIdentifier: IDS.recipient.fields.error, position: 8, isVisible: true, size: 260 },
  ],
});
