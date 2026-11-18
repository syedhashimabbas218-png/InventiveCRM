import { definePageLayout, PageLayoutTabLayoutMode, PageLayoutWidgetVerticalListHeightBehavior } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default definePageLayout({
  universalIdentifier: IDS.pageLayouts.inbox,
  name: 'WhatsApp inbox',
  type: 'STANDALONE_PAGE',
  tabs: [
    {
      universalIdentifier: IDS.pageLayoutTabs.inbox,
      title: 'Inbox',
      position: 0,
      icon: 'IconInbox',
      layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
      widgets: [
        {
          universalIdentifier: IDS.pageLayoutWidgets.inbox,
          title: ' ',
          type: 'FRONT_COMPONENT',
          heightBehavior: PageLayoutWidgetVerticalListHeightBehavior.TAB_VIEWPORT,
          configuration: { configurationType: 'FRONT_COMPONENT', frontComponentUniversalIdentifier: IDS.frontComponents.inbox },
        },
      ],
    },
  ],
});
