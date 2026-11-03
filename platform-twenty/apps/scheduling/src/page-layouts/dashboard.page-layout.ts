import { definePageLayout, PageLayoutTabLayoutMode, PageLayoutWidgetVerticalListHeightBehavior } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default definePageLayout({
  universalIdentifier: IDS.pageLayouts.dashboard,
  name: 'Scheduling',
  type: 'STANDALONE_PAGE',
  tabs: [
    {
      universalIdentifier: IDS.pageLayoutTabs.dashboard,
      title: 'Scheduling',
      position: 0,
      icon: 'IconLayoutDashboard',
      layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
      widgets: [
        {
          universalIdentifier: IDS.pageLayoutWidgets.dashboard,
          title: ' ',
          type: 'FRONT_COMPONENT',
          heightBehavior: PageLayoutWidgetVerticalListHeightBehavior.TAB_VIEWPORT,
          configuration: { configurationType: 'FRONT_COMPONENT', frontComponentUniversalIdentifier: IDS.frontComponents.dashboard },
        },
      ],
    },
  ],
});
