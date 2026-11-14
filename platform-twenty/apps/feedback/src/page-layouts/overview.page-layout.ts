import { definePageLayout, PageLayoutTabLayoutMode, PageLayoutWidgetVerticalListHeightBehavior } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default definePageLayout({
  universalIdentifier: IDS.pageLayouts.overview,
  name: 'Feedback',
  type: 'STANDALONE_PAGE',
  tabs: [
    {
      universalIdentifier: IDS.pageLayoutTabs.overview,
      title: 'Overview',
      position: 0,
      icon: 'IconMoodSmile',
      layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
      widgets: [
        {
          universalIdentifier: IDS.pageLayoutWidgets.overview,
          title: ' ',
          type: 'FRONT_COMPONENT',
          heightBehavior: PageLayoutWidgetVerticalListHeightBehavior.TAB_VIEWPORT,
          configuration: { configurationType: 'FRONT_COMPONENT', frontComponentUniversalIdentifier: IDS.frontComponents.overview },
        },
      ],
    },
  ],
});
