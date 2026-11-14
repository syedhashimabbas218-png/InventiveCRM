import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.detractors,
  name: 'Needs follow-up',
  objectUniversalIdentifier: IDS.request.object,
  icon: 'IconMoodSad',
  position: 1,
  filters: [
    { universalIdentifier: '668c6e04-9a36-40d0-967e-2fa53244217e', fieldMetadataUniversalIdentifier: IDS.request.fields.status, operand: 'IS', value: ['ANSWERED'] },
    { universalIdentifier: '23e6ac74-2d99-4160-bc97-3f930681b38c', fieldMetadataUniversalIdentifier: IDS.request.fields.score, operand: 'LESS_THAN_OR_EQUAL', value: 6 },
  ],
  fields: [
    { universalIdentifier: 'e99f70ac-445f-4373-a2b2-2d4862bd0889', fieldMetadataUniversalIdentifier: IDS.request.fields.name, position: 0, isVisible: true, size: 220 },
    { universalIdentifier: 'e45a4cb7-d221-441f-9a81-0869c4ea1b7f', fieldMetadataUniversalIdentifier: IDS.request.fields.person, position: 1, isVisible: true, size: 180 },
    { universalIdentifier: '104ba2eb-c1b1-40d1-9853-b55c53ab5bfe', fieldMetadataUniversalIdentifier: IDS.request.fields.score, position: 2, isVisible: true, size: 110 },
    { universalIdentifier: 'e1eff674-8095-42ff-b18b-a8e5e95a7ecd', fieldMetadataUniversalIdentifier: IDS.request.fields.comment, position: 3, isVisible: true, size: 360 },
    { universalIdentifier: '42a0888c-cd5f-4d7c-aa43-d91842bec7f2', fieldMetadataUniversalIdentifier: IDS.request.fields.answeredAt, position: 4, isVisible: true, size: 160 },
    { universalIdentifier: '9f267332-7ce5-4c2a-ab07-9773d97c174e', fieldMetadataUniversalIdentifier: IDS.request.fields.followUpTaskId, position: 5, isVisible: true, size: 160 },
  ],
});
