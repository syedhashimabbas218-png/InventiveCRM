import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.appointmentTypes,
  name: "Appointment types",
  objectUniversalIdentifier: IDS.appointmentType.object,
  icon: 'IconCalendarEvent',
  position: 0,
  fields: [
    {
      universalIdentifier: 'b473ed72-d747-4532-b306-20318e876f21',
      fieldMetadataUniversalIdentifier: IDS.appointmentType.fields.name,
      position: 0,
      isVisible: true,
      size: 240,
    },
    {
      universalIdentifier: '1b8a0e29-4915-4440-99cc-8efe6c4acfd6',
      fieldMetadataUniversalIdentifier: IDS.appointmentType.fields.status,
      position: 1,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'c54766f9-d86d-461a-9896-16b3c9c5372b',
      fieldMetadataUniversalIdentifier: IDS.appointmentType.fields.durationMinutes,
      position: 2,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '10b9d1a7-ee29-4701-9f7e-12152f95c23c',
      fieldMetadataUniversalIdentifier: IDS.appointmentType.fields.meetingFormat,
      position: 3,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '3bd6b532-b784-4dc1-9fe8-9fd05a3a4227',
      fieldMetadataUniversalIdentifier: IDS.appointmentType.fields.assignment,
      position: 4,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'ae374fde-472d-4450-a66c-87db13fe4cb1',
      fieldMetadataUniversalIdentifier: IDS.appointmentType.fields.locationMode,
      position: 5,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'f2fe864c-9d9b-474f-9e6b-dd888c7fe17b',
      fieldMetadataUniversalIdentifier: IDS.appointmentType.fields.slug,
      position: 6,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'ca26d332-1f02-40c5-8508-0d589716b5f4',
      fieldMetadataUniversalIdentifier: IDS.appointmentType.fields.owner,
      position: 7,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '07a6d912-15e4-40e2-a3ac-3f5c5a6dd0b4',
      fieldMetadataUniversalIdentifier: IDS.appointmentType.fields.team,
      position: 8,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'bd833ba5-6398-4da1-82fa-06ccc98de183',
      fieldMetadataUniversalIdentifier: IDS.appointmentType.fields.capacity,
      position: 9,
      isVisible: true,
      size: 160,
    },
  ],
});
