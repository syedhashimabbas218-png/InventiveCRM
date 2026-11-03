import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.teams,
  name: "Teams",
  objectUniversalIdentifier: IDS.schedulingTeam.object,
  icon: 'IconUsersGroup',
  position: 0,
  fields: [
    {
      universalIdentifier: '2cac38b5-91d2-4ebd-8771-f8f64fb61a9a',
      fieldMetadataUniversalIdentifier: IDS.schedulingTeam.fields.name,
      position: 0,
      isVisible: true,
      size: 240,
    },
    {
      universalIdentifier: 'bca4c103-878f-4b62-baea-7f96c0c7442a',
      fieldMetadataUniversalIdentifier: IDS.schedulingTeam.fields.slug,
      position: 1,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '2f2da481-e7fd-4893-86e1-83ca630a9758',
      fieldMetadataUniversalIdentifier: IDS.schedulingTeam.fields.isActive,
      position: 2,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '9e6d3fcc-5398-4ec9-8556-995f5fe93a04',
      fieldMetadataUniversalIdentifier: IDS.schedulingTeam.fields.fairnessWindowDays,
      position: 3,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'ec931458-e7ed-426f-8261-b45cbe185797',
      fieldMetadataUniversalIdentifier: IDS.schedulingTeam.fields.memberships,
      position: 4,
      isVisible: true,
      size: 160,
    },
  ],
});
