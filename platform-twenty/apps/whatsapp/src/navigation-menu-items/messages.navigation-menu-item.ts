import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineNavigationMenuItem({
  universalIdentifier: IDS.navigation.messages,
  name: 'Messages',
  icon: 'IconMessageCircle',
  position: 2,
  folderUniversalIdentifier: IDS.navigation.folder,
  type: NavigationMenuItemType.VIEW,
  viewUniversalIdentifier: IDS.views.messages.view,
});
