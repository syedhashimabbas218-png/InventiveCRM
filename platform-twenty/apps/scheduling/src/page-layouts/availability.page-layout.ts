import { definePageLayout, PageLayoutTabLayoutMode, PageLayoutWidgetVerticalListHeightBehavior } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default definePageLayout({
  universalIdentifier: IDS.pageLayouts.availability,
  name: 'Availability',
  type: 'STANDALONE_PAGE',
  tabs: [
    {
      universalIdentifier: IDS.pageLayoutTabs.availability,
      title: 'Availability',
      position: 0,
      icon: 'IconCalendarTime',
      layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
      widgets: [
        {
          universalIdentifier: IDS.pageLayoutWidgets.availability,
          title: ' ',
          type: 'FRONT_COMPONENT',
          heightBehavior: PageLayoutWidgetVerticalListHeightBehavior.TAB_VIEWPORT,
          configuration: { configurationType: 'FRONT_COMPONENT', frontComponentUniversalIdentifier: IDS.frontComponents.availability },
        },
      ],
    },
  ],
});
