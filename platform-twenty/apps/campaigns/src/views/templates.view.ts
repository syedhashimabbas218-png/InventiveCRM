import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.templates,
  name: 'Email templates',
  objectUniversalIdentifier: IDS.template.object,
  icon: 'IconTemplate',
  position: 0,
  fields: [
    { universalIdentifier: '249363b2-1a07-4a84-9d4d-a4664482f591', fieldMetadataUniversalIdentifier: IDS.template.fields.name, position: 0, isVisible: true, size: 240 },
    { universalIdentifier: 'c6505ed3-61ba-4eef-bdd0-1457ab89fd30', fieldMetadataUniversalIdentifier: IDS.template.fields.category, position: 1, isVisible: true, size: 150 },
    { universalIdentifier: 'db7c5e84-11fb-4942-953b-fa74bb9dd49b', fieldMetadataUniversalIdentifier: IDS.template.fields.description, position: 2, isVisible: true, size: 320 },
  ],
});
