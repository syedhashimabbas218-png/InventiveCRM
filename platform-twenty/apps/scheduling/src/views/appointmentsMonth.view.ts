import { defineView, ViewCalendarLayout, ViewType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.appointmentsMonth,
  name: "Appointment calendar (month)",
  objectUniversalIdentifier: IDS.appointment.object,
  icon: 'IconCalendarMonth',
  position: 0,
  type: ViewType.CALENDAR,
  calendarLayout: ViewCalendarLayout.MONTH,
  calendarFieldMetadataUniversalIdentifier: IDS.appointment.fields.startsAt,
  calendarEndFieldMetadataUniversalIdentifier: IDS.appointment.fields.endsAt,
  fields: [
    {
      universalIdentifier: 'ea1d151b-34ff-4ac4-81db-9f8f26f30883',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.title,
      position: 0,
      isVisible: true,
      size: 240,
    },
    {
      universalIdentifier: '0b523281-fbb6-44fa-8abf-6a9db39767dd',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.status,
      position: 1,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '3390cfeb-055c-432a-9be2-1e2c3cf06653',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.advisor,
      position: 2,
      isVisible: true,
      size: 160,
    },
  ],
});
