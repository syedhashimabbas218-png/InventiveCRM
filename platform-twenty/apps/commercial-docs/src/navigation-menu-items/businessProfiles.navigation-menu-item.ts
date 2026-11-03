import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineNavigationMenuItem({
  universalIdentifier: IDS.navigation.businessProfiles,
  name: 'Business profile',
  icon: 'IconBuildingStore',
  color: 'gray',
  position: 23,
  type: NavigationMenuItemType.VIEW,
  viewUniversalIdentifier: IDS.views.businessProfiles,
});
