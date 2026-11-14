import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineNavigationMenuItem({
  universalIdentifier: IDS.navigation.requests,
  name: 'All feedback',
  icon: 'IconMoodSmile',
  position: 1,
  folderUniversalIdentifier: IDS.navigation.folder,
  type: NavigationMenuItemType.VIEW,
  viewUniversalIdentifier: IDS.views.requests,
});
