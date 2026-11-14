import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.settings,
  name: 'Feedback settings',
  objectUniversalIdentifier: IDS.settings.object,
  icon: 'IconSettings',
  position: 0,
  fields: [
    { universalIdentifier: '0c03b9cb-e66b-444c-a0f4-0500cc0603f2', fieldMetadataUniversalIdentifier: IDS.settings.fields.name, position: 0, isVisible: true, size: 200 },
    { universalIdentifier: '6ec79ce3-5873-441a-9146-907ec5025bc2', fieldMetadataUniversalIdentifier: IDS.settings.fields.enabled, position: 1, isVisible: true, size: 150 },
    { universalIdentifier: '7727e7bc-ace5-4fb7-aaff-c1cfa0ee1c09', fieldMetadataUniversalIdentifier: IDS.settings.fields.channel, position: 2, isVisible: true, size: 160 },
    { universalIdentifier: 'eff1d45a-5c0f-44b2-ac90-b33b98aabf4c', fieldMetadataUniversalIdentifier: IDS.settings.fields.afterAppointments, position: 3, isVisible: true, size: 190 },
    { universalIdentifier: '4893e02a-7854-41f2-b5cd-fbfcba8fae17', fieldMetadataUniversalIdentifier: IDS.settings.fields.afterPaidInvoices, position: 4, isVisible: true, size: 170 },
    { universalIdentifier: '0c8b280d-6999-4d85-8eb9-6914147375a7', fieldMetadataUniversalIdentifier: IDS.settings.fields.delayHours, position: 5, isVisible: true, size: 160 },
    { universalIdentifier: '7039f5e8-7670-4100-bf6c-499e4f8519f8', fieldMetadataUniversalIdentifier: IDS.settings.fields.alertEmails, position: 6, isVisible: true, size: 220 },
    { universalIdentifier: '7505bd90-43da-4c91-817f-df4fd3bf1c99', fieldMetadataUniversalIdentifier: IDS.settings.fields.googleReviewUrl, position: 7, isVisible: true, size: 240 },
  ],
});
