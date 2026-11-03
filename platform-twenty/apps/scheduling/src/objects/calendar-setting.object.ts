import { defineObject } from 'twenty-sdk/define';

import { CONFERENCING, CONNECTION_STATUSES, PROVIDERS } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { dateTimeField, jsonField, selectField, textField } from 'src/objects/field-builders';

const field = IDS.calendarSetting.fields;

export default defineObject({
  universalIdentifier: IDS.calendarSetting.object,
  nameSingular: 'calendarSetting',
  namePlural: 'calendarSettings',
  labelSingular: "Calendar connection",
  labelPlural: "Calendar connections",
  description: "How an advisor uses a connected Google or Microsoft account: calendars that block time and the calendar bookings go to.",
  icon: 'IconCalendarShare',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: "Account", icon: 'IconTag' }),
    textField({ universalIdentifier: field.connectionId, name: 'connectionId', label: "Connection id", icon: 'IconKey', isUnique: true }),
    selectField({ universalIdentifier: field.provider, name: 'provider', label: "Provider", icon: 'IconBrandGoogle' }, PROVIDERS),
    textField({ universalIdentifier: field.accountEmail, name: 'accountEmail', label: "Account email", icon: 'IconMail' }),
    jsonField({ universalIdentifier: field.availabilityCalendarIds, name: 'availabilityCalendarIds', label: "Calendars that block time", icon: 'IconCalendarOff' }),
    textField({ universalIdentifier: field.bookingCalendarId, name: 'bookingCalendarId', label: "Calendar for new bookings", icon: 'IconCalendarPlus' }),
    selectField({ universalIdentifier: field.conferencing, name: 'conferencing', label: "Default conferencing", icon: 'IconVideo' }, CONFERENCING, 'NONE'),
    selectField({ universalIdentifier: field.status, name: 'status', label: "Status", icon: 'IconPlugConnected' }, CONNECTION_STATUSES, 'CONNECTED'),
    textField({ universalIdentifier: field.lastError, name: 'lastError', label: "Last error", icon: 'IconAlertTriangle' }),
    dateTimeField({ universalIdentifier: field.lastCheckedAt, name: 'lastCheckedAt', label: "Last checked", icon: 'IconClock' }),
  ],
});
