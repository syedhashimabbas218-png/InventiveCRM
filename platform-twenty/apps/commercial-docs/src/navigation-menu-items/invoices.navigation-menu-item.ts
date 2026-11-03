import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineNavigationMenuItem({
  universalIdentifier: IDS.navigation.invoices,
  name: 'Invoices',
  icon: 'IconFileInvoice',
  color: 'blue',
  position: 20,
  type: NavigationMenuItemType.VIEW,
  viewUniversalIdentifier: IDS.views.invoices,
});
