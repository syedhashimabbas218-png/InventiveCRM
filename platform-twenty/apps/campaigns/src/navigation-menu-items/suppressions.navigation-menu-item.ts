import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineNavigationMenuItem({
  universalIdentifier: IDS.navigation.suppressions,
  name: 'Do-not-contact',
  icon: 'IconBan',
  position: 4,
  folderUniversalIdentifier: IDS.navigation.folder,
  viewUniversalIdentifier: IDS.views.suppressions,
  type: NavigationMenuItemType.VIEW,
});
