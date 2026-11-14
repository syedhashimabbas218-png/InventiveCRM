import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineNavigationMenuItem({
  universalIdentifier: IDS.navigation.studio,
  name: 'Campaign Studio',
  icon: 'IconLayoutDashboard',
  position: 0,
  folderUniversalIdentifier: IDS.navigation.folder,
  pageLayoutUniversalIdentifier: IDS.pageLayouts.studio,
  type: NavigationMenuItemType.PAGE_LAYOUT,
});
