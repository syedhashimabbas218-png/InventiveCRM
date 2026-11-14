import { definePageLayout, PageLayoutTabLayoutMode, PageLayoutWidgetVerticalListHeightBehavior } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default definePageLayout({
  universalIdentifier: IDS.pageLayouts.studio,
  name: 'Campaign Studio',
  type: 'STANDALONE_PAGE',
  tabs: [
    {
      universalIdentifier: IDS.pageLayoutTabs.studio,
      title: 'Studio',
      position: 0,
      icon: 'IconSpeakerphone',
      layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
      widgets: [
        {
          universalIdentifier: IDS.pageLayoutWidgets.studio,
          title: ' ',
          type: 'FRONT_COMPONENT',
          heightBehavior: PageLayoutWidgetVerticalListHeightBehavior.TAB_VIEWPORT,
          configuration: { configurationType: 'FRONT_COMPONENT', frontComponentUniversalIdentifier: IDS.frontComponents.studio },
        },
      ],
    },
  ],
});
