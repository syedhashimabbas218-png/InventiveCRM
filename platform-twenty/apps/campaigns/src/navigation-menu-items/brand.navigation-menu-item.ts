import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineNavigationMenuItem({
  universalIdentifier: IDS.navigation.brand,
  name: 'Brand kit',
  icon: 'IconPalette',
  position: 5,
  folderUniversalIdentifier: IDS.navigation.folder,
  viewUniversalIdentifier: IDS.views.brand,
  type: NavigationMenuItemType.VIEW,
});
