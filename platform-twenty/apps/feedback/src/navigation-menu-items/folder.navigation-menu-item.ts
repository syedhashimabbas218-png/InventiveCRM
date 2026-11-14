import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineNavigationMenuItem({
  universalIdentifier: IDS.navigation.folder,
  name: 'Feedback',
  icon: 'IconMoodSmile',
  color: 'green',
  position: 40,
  type: NavigationMenuItemType.FOLDER,
});
