import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineNavigationMenuItem({
  universalIdentifier: IDS.navigation.campaigns,
  name: 'All campaigns',
  icon: 'IconSpeakerphone',
  position: 1,
  folderUniversalIdentifier: IDS.navigation.folder,
  viewUniversalIdentifier: IDS.views.campaigns,
  type: NavigationMenuItemType.VIEW,
});
