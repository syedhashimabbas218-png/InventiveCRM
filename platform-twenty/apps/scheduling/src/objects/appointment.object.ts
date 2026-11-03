import { defineObject } from 'twenty-sdk/define';

import { APPOINTMENT_STATUSES, BOOKING_SOURCES, CALENDAR_STATUSES, MEETING_FORMATS } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { dateTimeField, jsonField, numberField, selectField, textField } from 'src/objects/field-builders';

const field = IDS.appointment.fields;

export default defineObject({
  universalIdentifier: IDS.appointment.object,
  nameSingular: 'appointment',
  namePlural: 'appointments',
  labelSingular: "Appointment",
  labelPlural: "Appointments",
  description: "A booked appointment, linked to the customer, advisor, type and calendar events.",
  icon: 'IconCalendarCheck',
  labelIdentifierFieldMetadataUniversalIdentifier: field.title,
  fields: [
    textField({ universalIdentifier: field.title, name: 'title', label: "Title", icon: 'IconTag' }),
    selectField({ universalIdentifier: field.status, name: 'status', label: "Status", icon: 'IconProgressCheck' }, APPOINTMENT_STATUSES, 'CONFIRMED'),
    dateTimeField({ universalIdentifier: field.startsAt, name: 'startsAt', label: "Starts", icon: 'IconCalendarClock' }),
    dateTimeField({ universalIdentifier: field.endsAt, name: 'endsAt', label: "Ends", icon: 'IconCalendarClock' }),
    textField({ universalIdentifier: field.customerTimeZone, name: 'customerTimeZone', label: "Customer time zone", icon: 'IconWorld' }),
    textField({ universalIdentifier: field.customerName, name: 'customerName', label: "Customer name", icon: 'IconUser' }),
    textField({ universalIdentifier: field.customerEmail, name: 'customerEmail', label: "Customer email", icon: 'IconMail' }),
    textField({ universalIdentifier: field.customerPhone, name: 'customerPhone', label: "Customer phone", icon: 'IconPhone' }),
    selectField({ universalIdentifier: field.meetingFormat, name: 'meetingFormat', label: "Format", icon: 'IconMapPin' }, MEETING_FORMATS),
    textField({ universalIdentifier: field.location, name: 'location', label: "Where", icon: 'IconMapPin' }),
    numberField({ universalIdentifier: field.customerLatitude, name: 'customerLatitude', label: "Customer latitude", icon: 'IconMapPin' }, { decimals: 6 }),
    numberField({ universalIdentifier: field.customerLongitude, name: 'customerLongitude', label: "Customer longitude", icon: 'IconMapPin' }, { decimals: 6 }),
    textField({ universalIdentifier: field.customerPostcode, name: 'customerPostcode', label: "Customer postcode", icon: 'IconMailbox' }),
    textField({ universalIdentifier: field.meetingUrl, name: 'meetingUrl', label: "Meeting link", icon: 'IconVideo' }),
    jsonField({ universalIdentifier: field.intakeAnswers, name: 'intakeAnswers', label: "Answers", icon: 'IconForms' }),
    textField({ universalIdentifier: field.notes, name: 'notes', label: "Notes", icon: 'IconNotes' }),
    selectField({ universalIdentifier: field.source, name: 'source', label: "Booked via", icon: 'IconSourceCode' }, BOOKING_SOURCES, 'MANUAL'),
    textField({ universalIdentifier: field.sessionKey, name: 'sessionKey', label: "Session", icon: 'IconKey' }),
    numberField({ universalIdentifier: field.seat, name: 'seat', label: "Seat", icon: 'IconArmchair' }, { integer: true }),
    textField({ universalIdentifier: field.assignmentReason, name: 'assignmentReason', label: "Why this advisor", icon: 'IconInfoCircle' }),
    numberField({ universalIdentifier: field.travelMinutes, name: 'travelMinutes', label: "Travel time (minutes)", icon: 'IconCar' }, { integer: true }),
    textField({ universalIdentifier: field.travelCheck, name: 'travelCheck', label: "Travel check", icon: 'IconRoute' }),
    textField({ universalIdentifier: field.manageNonce, name: 'manageNonce', label: "Manage link version", icon: 'IconLock', description: "Changing it invalidates the customer manage link." }),
    textField({ universalIdentifier: field.idempotencyKey, name: 'idempotencyKey', label: "Idempotency key", icon: 'IconKey', isUnique: true }),
    dateTimeField({ universalIdentifier: field.cancelledAt, name: 'cancelledAt', label: "Cancelled at", icon: 'IconCalendarX' }),
    textField({ universalIdentifier: field.cancelReason, name: 'cancelReason', label: "Cancellation reason", icon: 'IconMessageX' }),
    textField({ universalIdentifier: field.cancelledBy, name: 'cancelledBy', label: "Cancelled by", icon: 'IconUserX' }),
    dateTimeField({ universalIdentifier: field.notifiedStartsAt, name: 'notifiedStartsAt', label: "Customer told about time", icon: 'IconMailCheck' }),
    textField({ universalIdentifier: field.remindersSent, name: 'remindersSent', label: "Reminders sent", icon: 'IconBell' }),
    selectField({ universalIdentifier: field.calendarStatus, name: 'calendarStatus', label: "Calendar", icon: 'IconCalendarShare' }, CALENDAR_STATUSES, 'NOT_CONNECTED'),
  ],
});
