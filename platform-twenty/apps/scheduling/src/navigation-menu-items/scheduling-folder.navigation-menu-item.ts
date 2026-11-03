import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineNavigationMenuItem({
  universalIdentifier: IDS.navigation.folder,
  name: 'Scheduling',
  icon: 'IconCalendarEvent',
  color: 'blue',
  position: 30,
  type: NavigationMenuItemType.FOLDER,
});
