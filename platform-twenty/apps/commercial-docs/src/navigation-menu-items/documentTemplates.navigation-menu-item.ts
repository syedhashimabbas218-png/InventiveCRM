import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineNavigationMenuItem({
  universalIdentifier: IDS.navigation.documentTemplates,
  name: 'Document templates',
  icon: 'IconTemplate',
  color: 'gray',
  position: 24,
  type: NavigationMenuItemType.VIEW,
  viewUniversalIdentifier: IDS.views.documentTemplates,
});
