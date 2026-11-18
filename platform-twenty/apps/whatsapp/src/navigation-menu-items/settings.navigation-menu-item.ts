import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineNavigationMenuItem({
  universalIdentifier: IDS.navigation.settings,
  name: 'Settings',
  icon: 'IconSettings',
  position: 3,
  folderUniversalIdentifier: IDS.navigation.folder,
  type: NavigationMenuItemType.VIEW,
  viewUniversalIdentifier: IDS.views.settings.view,
});
