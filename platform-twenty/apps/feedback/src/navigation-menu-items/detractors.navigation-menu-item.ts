import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineNavigationMenuItem({
  universalIdentifier: IDS.navigation.detractors,
  name: 'Needs follow-up',
  icon: 'IconMoodSad',
  position: 2,
  folderUniversalIdentifier: IDS.navigation.folder,
  type: NavigationMenuItemType.VIEW,
  viewUniversalIdentifier: IDS.views.detractors,
});
