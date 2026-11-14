import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.campaigns,
  name: 'All campaigns',
  objectUniversalIdentifier: IDS.campaign.object,
  icon: 'IconSpeakerphone',
  position: 0,
  fields: [
    { universalIdentifier: '3f6eefba-6a5a-4a9d-86c1-846902e808c6', fieldMetadataUniversalIdentifier: IDS.campaign.fields.name, position: 0, isVisible: true, size: 220 },
    { universalIdentifier: 'b9899653-36b3-4b8e-8830-4d9ee41cb20f', fieldMetadataUniversalIdentifier: IDS.campaign.fields.status, position: 1, isVisible: true, size: 120 },
    { universalIdentifier: '7508c750-675d-4b34-82a1-cbdf4a5272c2', fieldMetadataUniversalIdentifier: IDS.campaign.fields.channel, position: 2, isVisible: true, size: 110 },
    { universalIdentifier: '7e7c0c24-5636-46e3-a460-5b711f6ed64d', fieldMetadataUniversalIdentifier: IDS.campaign.fields.listName, position: 3, isVisible: true, size: 180 },
    { universalIdentifier: '74f246b9-07fa-49c1-a2cb-388679d7ab5b', fieldMetadataUniversalIdentifier: IDS.campaign.fields.scheduledAt, position: 4, isVisible: true, size: 160 },
    { universalIdentifier: 'c4ea61d7-a200-41cd-8ec3-a994146b75d1', fieldMetadataUniversalIdentifier: IDS.campaign.fields.sentAt, position: 5, isVisible: true, size: 160 },
    { universalIdentifier: '531c15f9-8f97-4e0f-945c-dc2f4f7b7911', fieldMetadataUniversalIdentifier: IDS.campaign.fields.recipientCount, position: 6, isVisible: true, size: 110 },
    { universalIdentifier: '760a558d-0e12-4a3a-8e1a-5203df147742', fieldMetadataUniversalIdentifier: IDS.campaign.fields.deliveredCount, position: 7, isVisible: true, size: 110 },
    { universalIdentifier: 'd5a1af08-68de-4231-9e71-83aafbeb7d0f', fieldMetadataUniversalIdentifier: IDS.campaign.fields.openedCount, position: 8, isVisible: true, size: 100 },
    { universalIdentifier: 'afc45ad4-e185-428a-b7be-dff1e413294f', fieldMetadataUniversalIdentifier: IDS.campaign.fields.clickedCount, position: 9, isVisible: true, size: 100 },
    { universalIdentifier: '97d2c8c4-28b9-4786-81e3-3636097f4d13', fieldMetadataUniversalIdentifier: IDS.campaign.fields.unsubscribedCount, position: 10, isVisible: true, size: 120 },
    { universalIdentifier: '2aab49ba-1270-4f0e-b28a-acce68033567', fieldMetadataUniversalIdentifier: IDS.campaign.fields.bouncedCount, position: 11, isVisible: true, size: 100 },
  ],
});
