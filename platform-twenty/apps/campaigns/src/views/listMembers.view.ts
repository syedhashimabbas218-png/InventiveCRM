import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.listMembers,
  name: 'List members',
  objectUniversalIdentifier: IDS.listMember.object,
  icon: 'IconUserPlus',
  position: 0,
  fields: [
    { universalIdentifier: '1635d994-0fcd-45b2-92f3-b4787866ce60', fieldMetadataUniversalIdentifier: IDS.listMember.fields.list, position: 0, isVisible: true, size: 220 },
    { universalIdentifier: '9691621d-7543-4b41-b77b-f526f8bb4764', fieldMetadataUniversalIdentifier: IDS.listMember.fields.person, position: 1, isVisible: true, size: 220 },
  ],
});
