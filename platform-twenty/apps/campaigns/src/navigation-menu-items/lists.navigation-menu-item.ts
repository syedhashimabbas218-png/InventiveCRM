import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineNavigationMenuItem({
  universalIdentifier: IDS.navigation.lists,
  name: 'Mailing lists',
  icon: 'IconList',
  position: 2,
  folderUniversalIdentifier: IDS.navigation.folder,
  viewUniversalIdentifier: IDS.views.lists,
  type: NavigationMenuItemType.VIEW,
});
