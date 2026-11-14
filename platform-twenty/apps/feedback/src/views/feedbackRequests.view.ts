import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.requests,
  name: 'All feedback',
  objectUniversalIdentifier: IDS.request.object,
  icon: 'IconMoodSmile',
  position: 0,
  fields: [
    { universalIdentifier: 'aa040cf7-175d-46e5-8a5f-81da754f792d', fieldMetadataUniversalIdentifier: IDS.request.fields.name, position: 0, isVisible: true, size: 220 },
    { universalIdentifier: '7e97ece6-5d71-4963-814f-c12045d3fa2e', fieldMetadataUniversalIdentifier: IDS.request.fields.person, position: 1, isVisible: true, size: 180 },
    { universalIdentifier: 'a245301e-fe7c-4c51-81bb-ae07b77bfa64', fieldMetadataUniversalIdentifier: IDS.request.fields.status, position: 2, isVisible: true, size: 130 },
    { universalIdentifier: '4484240b-13cf-4e94-a715-e6a06e67b8df', fieldMetadataUniversalIdentifier: IDS.request.fields.score, position: 3, isVisible: true, size: 110 },
    { universalIdentifier: 'dfb3537a-3310-4dfb-86eb-a1a110d2df2a', fieldMetadataUniversalIdentifier: IDS.request.fields.comment, position: 4, isVisible: true, size: 300 },
    { universalIdentifier: '2ffc5231-c54c-449c-b423-964f7b89a380', fieldMetadataUniversalIdentifier: IDS.request.fields.source, position: 5, isVisible: true, size: 170 },
    { universalIdentifier: '0ca84215-8840-4dd0-9cdc-404f97539f94', fieldMetadataUniversalIdentifier: IDS.request.fields.channel, position: 6, isVisible: true, size: 150 },
    { universalIdentifier: '44475644-8d92-4526-bf82-14d31ede2535', fieldMetadataUniversalIdentifier: IDS.request.fields.answeredAt, position: 7, isVisible: true, size: 160 },
    { universalIdentifier: '245393c3-19bc-48a4-8b59-a0d3470c8766', fieldMetadataUniversalIdentifier: IDS.request.fields.sentAt, position: 8, isVisible: true, size: 160 },
  ],
});
