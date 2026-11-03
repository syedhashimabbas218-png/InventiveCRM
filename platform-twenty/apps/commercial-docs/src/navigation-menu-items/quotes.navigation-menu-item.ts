import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineNavigationMenuItem({
  universalIdentifier: IDS.navigation.quotes,
  name: 'Quotes',
  icon: 'IconFileDescription',
  color: 'green',
  position: 21,
  type: NavigationMenuItemType.VIEW,
  viewUniversalIdentifier: IDS.views.quotes,
});
