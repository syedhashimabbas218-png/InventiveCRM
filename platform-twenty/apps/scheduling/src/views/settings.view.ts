import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.settings,
  name: "Scheduling settings",
  objectUniversalIdentifier: IDS.schedulingSettings.object,
  icon: 'IconSettings',
  position: 0,
  fields: [
    {
      universalIdentifier: '7e7edc00-53ad-4ee7-a601-234bf3960acf',
      fieldMetadataUniversalIdentifier: IDS.schedulingSettings.fields.name,
      position: 0,
      isVisible: true,
      size: 240,
    },
    {
      universalIdentifier: '07b06edd-ea5b-4112-bd3d-e373fa2e22e1',
      fieldMetadataUniversalIdentifier: IDS.schedulingSettings.fields.contactMatching,
      position: 1,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '675da095-f051-4146-831c-74c2e85032f6',
      fieldMetadataUniversalIdentifier: IDS.schedulingSettings.fields.createContacts,
      position: 2,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '01f6b524-cf34-4b3a-978e-63df51c6ebc2',
      fieldMetadataUniversalIdentifier: IDS.schedulingSettings.fields.defaultTimeZone,
      position: 3,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '56fe3d1e-2873-44bb-98be-c1593553963e',
      fieldMetadataUniversalIdentifier: IDS.schedulingSettings.fields.notifyAdvisors,
      position: 4,
      isVisible: true,
      size: 160,
    },
  ],
});
