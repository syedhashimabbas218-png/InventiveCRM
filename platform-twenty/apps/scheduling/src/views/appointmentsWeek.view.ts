import { defineView, ViewCalendarLayout, ViewType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.appointmentsWeek,
  name: "Appointment calendar (week)",
  objectUniversalIdentifier: IDS.appointment.object,
  icon: 'IconCalendarWeek',
  position: 0,
  type: ViewType.CALENDAR,
  calendarLayout: ViewCalendarLayout.WEEK,
  calendarFieldMetadataUniversalIdentifier: IDS.appointment.fields.startsAt,
  calendarEndFieldMetadataUniversalIdentifier: IDS.appointment.fields.endsAt,
  fields: [
    {
      universalIdentifier: '6a538192-37e8-4af9-a890-6e0c89705c2c',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.title,
      position: 0,
      isVisible: true,
      size: 240,
    },
    {
      universalIdentifier: 'abebdbbd-8b7d-4443-9b77-64faf93f9361',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.status,
      position: 1,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'cbd020a3-fad0-484b-b20a-4954cdf18109',
      fieldMetadataUniversalIdentifier: IDS.appointment.fields.advisor,
      position: 2,
      isVisible: true,
      size: 160,
    },
  ],
});
