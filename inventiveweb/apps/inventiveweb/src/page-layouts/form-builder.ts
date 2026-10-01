import { definePageLayout, PageLayoutTabLayoutMode, PageLayoutWidgetVerticalListHeightBehavior } from 'twenty-sdk/define';
export default definePageLayout({
  "universalIdentifier": "618425ad-c322-507a-80b9-5f47e7503770",
  "name": "Form builder",
  "type": "STANDALONE_PAGE",
  "tabs": [
    {
      "universalIdentifier": "c76e20fa-3fce-5013-8fc9-8dddbfbe25c0",
      "title": "Form builder",
      "position": 0,
      "icon": "IconForms",
      "layoutMode": PageLayoutTabLayoutMode.VERTICAL_LIST,
      "widgets": [
        {
          "universalIdentifier": "0852b9b5-7ab9-5d78-b0fa-c5f27bbe016a",
          "title": " ",
          "type": "FRONT_COMPONENT",
          "heightBehavior": PageLayoutWidgetVerticalListHeightBehavior.TAB_VIEWPORT,
          "configuration": {
            "configurationType": "FRONT_COMPONENT",
            "frontComponentUniversalIdentifier": "72e06ba5-a288-57f9-ae86-7c1d94431ea0"
          }
        }
      ]
    }
  ]
});
