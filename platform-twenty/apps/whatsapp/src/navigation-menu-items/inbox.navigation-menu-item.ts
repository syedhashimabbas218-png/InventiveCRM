import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineNavigationMenuItem({
  universalIdentifier: IDS.navigation.inbox,
  name: 'Inbox',
  icon: 'IconInbox',
  position: 0,
  folderUniversalIdentifier: IDS.navigation.folder,
  type: NavigationMenuItemType.PAGE_LAYOUT,
  pageLayoutUniversalIdentifier: IDS.pageLayouts.inbox,
});
