import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineNavigationMenuItem({
  universalIdentifier: IDS.navigation.templates,
  name: 'Templates',
  icon: 'IconTemplate',
  position: 3,
  folderUniversalIdentifier: IDS.navigation.folder,
  viewUniversalIdentifier: IDS.views.templates,
  type: NavigationMenuItemType.VIEW,
});
