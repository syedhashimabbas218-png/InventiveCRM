import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.lists,
  name: 'Mailing lists',
  objectUniversalIdentifier: IDS.list.object,
  icon: 'IconList',
  position: 0,
  fields: [
    { universalIdentifier: 'dbe0c83b-be84-41dc-b698-a71e8649e411', fieldMetadataUniversalIdentifier: IDS.list.fields.name, position: 0, isVisible: true, size: 240 },
    { universalIdentifier: '2e0799a5-02a7-4417-bb4b-05737563299a', fieldMetadataUniversalIdentifier: IDS.list.fields.memberCount, position: 1, isVisible: true, size: 120 },
    { universalIdentifier: '9fc2280a-6aed-4944-8df0-b0f8d2cdc7b0', fieldMetadataUniversalIdentifier: IDS.list.fields.description, position: 2, isVisible: true, size: 320 },
  ],
});
