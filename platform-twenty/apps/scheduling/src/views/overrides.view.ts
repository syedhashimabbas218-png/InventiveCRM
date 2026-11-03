import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.overrides,
  name: "Time off and special hours",
  objectUniversalIdentifier: IDS.availabilityOverride.object,
  icon: 'IconCalendarOff',
  position: 0,
  fields: [
    {
      universalIdentifier: 'd01734d2-2fb3-463c-8a59-1a80a63de432',
      fieldMetadataUniversalIdentifier: IDS.availabilityOverride.fields.name,
      position: 0,
      isVisible: true,
      size: 240,
    },
    {
      universalIdentifier: 'f511781f-c7a2-41e9-9f01-2000f51b7c30',
      fieldMetadataUniversalIdentifier: IDS.availabilityOverride.fields.schedule,
      position: 1,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '86094f95-2d90-4f6c-9326-244eb3b5f146',
      fieldMetadataUniversalIdentifier: IDS.availabilityOverride.fields.startDate,
      position: 2,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '0785b969-4b40-4f08-836e-2113d23f1e11',
      fieldMetadataUniversalIdentifier: IDS.availabilityOverride.fields.endDate,
      position: 3,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'd2242029-ed5a-467b-b09c-c54636b7154c',
      fieldMetadataUniversalIdentifier: IDS.availabilityOverride.fields.kind,
      position: 4,
      isVisible: true,
      size: 160,
    },
  ],
});
