import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineNavigationMenuItem({
  universalIdentifier: IDS.navigation.calendarSettings,
  name: "Calendar connections",
  icon: 'IconCalendarShare',
  position: 8,
  folderUniversalIdentifier: IDS.navigation.folder,
  type: NavigationMenuItemType.PAGE_LAYOUT,
  pageLayoutUniversalIdentifier: IDS.pageLayouts.connections,
});
