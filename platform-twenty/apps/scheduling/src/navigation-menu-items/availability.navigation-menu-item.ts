import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineNavigationMenuItem({
  universalIdentifier: IDS.navigation.availability,
  name: "Availability",
  icon: 'IconCalendarTime',
  position: 5,
  folderUniversalIdentifier: IDS.navigation.folder,
  type: NavigationMenuItemType.PAGE_LAYOUT,
  pageLayoutUniversalIdentifier: IDS.pageLayouts.availability,
});
