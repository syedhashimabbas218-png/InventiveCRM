import { definePageLayoutTab, PageLayoutTabLayoutMode, PageLayoutWidgetVerticalListHeightBehavior, STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default definePageLayoutTab({
  universalIdentifier: IDS.pageLayoutTabs.person,
  pageLayoutUniversalIdentifier: STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS.personRecordPage.universalIdentifier,
  title: 'WhatsApp',
  position: 62,
  icon: 'IconBrandWhatsapp',
  layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
  widgets: [
    {
      universalIdentifier: IDS.pageLayoutWidgets.person,
      title: 'WhatsApp',
      type: 'FRONT_COMPONENT',
      heightBehavior: PageLayoutWidgetVerticalListHeightBehavior.TAB_VIEWPORT,
      configuration: { configurationType: 'FRONT_COMPONENT', frontComponentUniversalIdentifier: IDS.frontComponents.recordTab },
    },
  ],
});
