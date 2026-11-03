import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.appointmentsAll,
  name: "All appointments",
  objectUniversalIdentifier: IDS.appointment.object,
  icon: 'IconCalendarCheck',
  position: 0,
  fields: [
    {
      universalIdentifier: '468e0754-9d1e-456a-b76a-769d35b151f9',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.title,
      position: 0,
      isVisible: true,
      size: 240,
    },
    {
      universalIdentifier: 'dd854792-543b-4da4-99d5-59f16dfbda4e',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.startsAt,
      position: 1,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '90aa4563-6b04-40f7-bc6e-3f7eef60e538',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.status,
      position: 2,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'cd37d7c5-5a90-42b3-a98f-9ca4ded209e3',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.advisor,
      position: 3,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'd9be51b7-33ce-4c2f-a256-d9c0260b6504',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.team,
      position: 4,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '9fcade75-57d0-45f2-85e0-3525551109f8',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.appointmentType,
      position: 5,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '4c03b3b5-9840-44ae-a576-943597f65b12',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.person,
      position: 6,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'cafd629a-100f-4c88-ad99-30a6b1827350',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.company,
      position: 7,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'a0170b13-7726-4fdf-85d9-8f365562b3a9',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.source,
      position: 8,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '9bd6869e-63de-476f-8803-1bdfb658f763',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.assignmentReason,
      position: 9,
      isVisible: true,
      size: 160,
    },
  ],
});
