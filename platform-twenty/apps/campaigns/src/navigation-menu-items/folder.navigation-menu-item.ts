import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineNavigationMenuItem({
  universalIdentifier: IDS.navigation.folder,
  name: 'Marketing',
  icon: 'IconSpeakerphone',
  position: 45,
  color: 'orange',
  type: NavigationMenuItemType.FOLDER,
});
