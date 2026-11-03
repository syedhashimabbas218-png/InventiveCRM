import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.appointmentsUpcoming,
  name: "Upcoming appointments",
  objectUniversalIdentifier: IDS.appointment.object,
  icon: 'IconCalendarCheck',
  position: 0,
  filters: [
    {
      universalIdentifier: 'cae03dc2-6a03-49d5-9d39-2589c4842cc6',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.startsAt,
      operand: 'IS_IN_FUTURE',
      value: "",
    },
  ],
  fields: [
    {
      universalIdentifier: '0fc9942e-c2c2-446a-8954-1c98802e35e2',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.title,
      position: 0,
      isVisible: true,
      size: 240,
    },
    {
      universalIdentifier: 'd5e3df84-a9e4-4c8b-92a3-5dad17c51942',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.startsAt,
      position: 1,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'cfea4f93-cd77-410d-beaa-191108a18726',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.status,
      position: 2,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '52242022-e44e-4083-8afe-b90fc66cd87b',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.advisor,
      position: 3,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '4ec842e4-63f5-4ef3-af89-1bd0f9b05179',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.appointmentType,
      position: 4,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '711ef56c-5d54-474b-a34f-259bbe6c6a49',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.person,
      position: 5,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'a5369848-fdca-4c41-8939-cd935819e2b6',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.meetingFormat,
      position: 6,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '5c91318c-dc96-4d46-91c8-1358344250c0',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.location,
      position: 7,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '9a275231-1a97-44cb-9a99-546f16316ebf',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.calendarStatus,
      position: 8,
      isVisible: true,
      size: 160,
    },
  ],
});
