import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.schedules,
  name: "Availability",
  objectUniversalIdentifier: IDS.availabilitySchedule.object,
  icon: 'IconCalendarTime',
  position: 0,
  fields: [
    {
      universalIdentifier: 'b841589e-4900-40a4-89ab-e9e4b43e5df3',
      fieldMetadataUniversalIdentifier: IDS.availabilitySchedule.fields.name,
      position: 0,
      isVisible: true,
      size: 240,
    },
    {
      universalIdentifier: 'b3970958-cdbd-43db-b6ed-b0420eca9bd7',
      fieldMetadataUniversalIdentifier: IDS.availabilitySchedule.fields.owner,
      position: 1,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'e7aad3e9-31c1-4948-9a9d-418429ba426b',
      fieldMetadataUniversalIdentifier: IDS.availabilitySchedule.fields.timeZone,
      position: 2,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'e11f7df1-1a4f-4a8c-8f55-a65648aaf920',
      fieldMetadataUniversalIdentifier: IDS.availabilitySchedule.fields.isDefault,
      position: 3,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'be7e7ed1-bc17-4ccf-9251-6323b14e1621',
      fieldMetadataUniversalIdentifier: IDS.availabilitySchedule.fields.overrides,
      position: 4,
      isVisible: true,
      size: 160,
    },
  ],
});
