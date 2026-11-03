import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineNavigationMenuItem({
  universalIdentifier: IDS.navigation.products,
  name: 'Products and services',
  icon: 'IconPackage',
  color: 'orange',
  position: 22,
  type: NavigationMenuItemType.VIEW,
  viewUniversalIdentifier: IDS.views.products,
});
