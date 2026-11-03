import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.calendarSettings,
  name: "Calendar connections",
  objectUniversalIdentifier: IDS.calendarSetting.object,
  icon: 'IconCalendarShare',
  position: 0,
  fields: [
    {
      universalIdentifier: '5696ac1e-5beb-403a-96f7-600951266573',
      fieldMetadataUniversalIdentifier: IDS.calendarSetting.fields.name,
      position: 0,
      isVisible: true,
      size: 240,
    },
    {
      universalIdentifier: 'e796b751-64dc-4cd9-b645-a279ebf3acaa',
      fieldMetadataUniversalIdentifier: IDS.calendarSetting.fields.advisor,
      position: 1,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '93d103ec-c068-466e-bf11-793289a36169',
      fieldMetadataUniversalIdentifier: IDS.calendarSetting.fields.provider,
      position: 2,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '8c4d4c0c-a47f-424a-ab13-85ec0e82ae35',
      fieldMetadataUniversalIdentifier: IDS.calendarSetting.fields.status,
      position: 3,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '447a2643-d2fb-4262-8345-687a5c2a4174',
      fieldMetadataUniversalIdentifier: IDS.calendarSetting.fields.bookingCalendarId,
      position: 4,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'db49a191-ce93-4601-a5ed-0cca1423c4c6',
      fieldMetadataUniversalIdentifier: IDS.calendarSetting.fields.lastError,
      position: 5,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '9f1f6b65-e14e-4f05-8f7c-b22933ea9d43',
      fieldMetadataUniversalIdentifier: IDS.calendarSetting.fields.lastCheckedAt,
      position: 6,
      isVisible: true,
      size: 160,
    },
  ],
});
