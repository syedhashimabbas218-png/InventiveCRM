import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.suppressions,
  name: 'Do-not-contact list',
  objectUniversalIdentifier: IDS.suppression.object,
  icon: 'IconBan',
  position: 0,
  fields: [
    { universalIdentifier: '4300e2a8-c53f-4f43-95e0-ce078b16dbc0', fieldMetadataUniversalIdentifier: IDS.suppression.fields.address, position: 0, isVisible: true, size: 240 },
    { universalIdentifier: '76181c31-146f-43ee-9006-b4a5ddfffa0c', fieldMetadataUniversalIdentifier: IDS.suppression.fields.channel, position: 1, isVisible: true, size: 110 },
    { universalIdentifier: 'ba1316b1-4574-4c2a-938b-7c4aeae21b48', fieldMetadataUniversalIdentifier: IDS.suppression.fields.reason, position: 2, isVisible: true, size: 150 },
    { universalIdentifier: '9d8b33de-cff8-4219-8a16-5e19f84d44d1', fieldMetadataUniversalIdentifier: IDS.suppression.fields.note, position: 3, isVisible: true, size: 260 },
  ],
});
