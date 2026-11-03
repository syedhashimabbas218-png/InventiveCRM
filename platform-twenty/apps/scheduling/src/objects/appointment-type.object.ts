import { defineObject } from 'twenty-sdk/define';

import { ASSIGNMENTS, CONFERENCING, DISTANCE_BASES, LOCATION_MODES, MEETING_FORMATS, ROUND_ROBIN_STRATEGIES, TYPE_STATUSES } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { booleanField, jsonField, numberField, selectField, textField } from 'src/objects/field-builders';

const field = IDS.appointmentType.fields;

export default defineObject({
  universalIdentifier: IDS.appointmentType.object,
  nameSingular: 'appointmentType',
  namePlural: 'appointmentTypes',
  labelSingular: "Appointment type",
  labelPlural: "Appointment types",
  description: "What customers can book: duration, format, who takes it, how it is assigned and the booking rules.",
  icon: 'IconCalendarEvent',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: "Name", icon: 'IconTag' }),
    textField({ universalIdentifier: field.slug, name: 'slug', label: "Booking slug", icon: 'IconLink', isUnique: true }),
    textField({ universalIdentifier: field.description, name: 'description', label: "Description", icon: 'IconAlignLeft' }),
    selectField({ universalIdentifier: field.status, name: 'status', label: "Status", icon: 'IconProgressCheck' }, TYPE_STATUSES, 'DRAFT'),
    textField({ universalIdentifier: field.color, name: 'color', label: "Colour", icon: 'IconPalette' }),
    textField({ universalIdentifier: field.icon, name: 'icon', label: "Icon", icon: 'IconIcons' }),
    numberField({ universalIdentifier: field.durationMinutes, name: 'durationMinutes', label: "Duration (minutes)", icon: 'IconClock' }, { integer: true, defaultValue: 30 }),
    selectField({ universalIdentifier: field.meetingFormat, name: 'meetingFormat', label: "Format", icon: 'IconMapPin' }, MEETING_FORMATS, 'VIRTUAL'),
    selectField({ universalIdentifier: field.conferencing, name: 'conferencing', label: "Video conferencing", icon: 'IconVideo' }, CONFERENCING, 'NONE'),
    textField({ universalIdentifier: field.meetingUrl, name: 'meetingUrl', label: "Fixed meeting link", icon: 'IconLink' }),
    selectField({ universalIdentifier: field.assignment, name: 'assignment', label: "Who takes it", icon: 'IconUsers' }, ASSIGNMENTS, 'ONE_TO_ONE'),
    selectField({ universalIdentifier: field.roundRobinStrategy, name: 'roundRobinStrategy', label: "Round-robin strategy", icon: 'IconArrowsShuffle' }, ROUND_ROBIN_STRATEGIES, 'EQUAL'),
    selectField({ universalIdentifier: field.locationMode, name: 'locationMode', label: "Location matching", icon: 'IconMap2' }, LOCATION_MODES, 'NONE'),
    selectField({ universalIdentifier: field.distanceBasis, name: 'distanceBasis', label: "Distance by", icon: 'IconRoute' }, DISTANCE_BASES, 'ROAD'),
    numberField({ universalIdentifier: field.capacity, name: 'capacity', label: "Seats per session", icon: 'IconUsers', description: "More than 1 makes it a group session." }, { integer: true, defaultValue: 1 }),
    numberField({ universalIdentifier: field.minimumNoticeMinutes, name: 'minimumNoticeMinutes', label: "Minimum notice (minutes)", icon: 'IconHourglass' }, { integer: true, defaultValue: 240 }),
    numberField({ universalIdentifier: field.horizonDays, name: 'horizonDays', label: "Bookable up to (days ahead)", icon: 'IconCalendarPlus' }, { integer: true, defaultValue: 60 }),
    numberField({ universalIdentifier: field.bufferBeforeMinutes, name: 'bufferBeforeMinutes', label: "Buffer before (minutes)", icon: 'IconArrowBarLeft' }, { integer: true, defaultValue: 0 }),
    numberField({ universalIdentifier: field.bufferAfterMinutes, name: 'bufferAfterMinutes', label: "Buffer after (minutes)", icon: 'IconArrowBarRight' }, { integer: true, defaultValue: 0 }),
    numberField({ universalIdentifier: field.incrementMinutes, name: 'incrementMinutes', label: "Start times every (minutes)", icon: 'IconClockPlay' }, { integer: true, defaultValue: 30 }),
    numberField({ universalIdentifier: field.dailyLimit, name: 'dailyLimit', label: "Daily limit per advisor", icon: 'IconCalendarStats' }, { integer: true }),
    numberField({ universalIdentifier: field.weeklyLimit, name: 'weeklyLimit', label: "Weekly limit per advisor", icon: 'IconCalendarStats' }, { integer: true }),
    textField({ universalIdentifier: field.timeZone, name: 'timeZone', label: "Display time zone", icon: 'IconWorld' }),
    numberField({ universalIdentifier: field.cancellationCutoffHours, name: 'cancellationCutoffHours', label: "Cancel up to (hours before)", icon: 'IconCalendarX' }, { integer: true, defaultValue: 24 }),
    numberField({ universalIdentifier: field.rescheduleCutoffHours, name: 'rescheduleCutoffHours', label: "Reschedule up to (hours before)", icon: 'IconCalendarRepeat' }, { integer: true, defaultValue: 24 }),
    jsonField({ universalIdentifier: field.intakeQuestions, name: 'intakeQuestions', label: "Intake questions", icon: 'IconForms', description: "[{\"id\":\"topic\",\"label\":\"What is it about?\",\"type\":\"text|textarea|select|phone\",\"required\":true,\"options\":[\"A\",\"B\"]}]" }),
    textField({ universalIdentifier: field.confirmationMessage, name: 'confirmationMessage', label: "Confirmation message", icon: 'IconMessageCheck' }),
    booleanField({ universalIdentifier: field.requiresApproval, name: 'requiresApproval', label: "Needs advisor approval", icon: 'IconUserCheck' }, false),
    textField({ universalIdentifier: field.reminderMinutes, name: 'reminderMinutes', label: "Reminders (minutes before)", icon: 'IconBell' }, "1440,60"),
    textField({ universalIdentifier: field.allowedEmbedDomains, name: 'allowedEmbedDomains', label: "Embeddable on domains", icon: 'IconCode', description: "Comma separated, e.g. example.co.uk, www.example.co.uk. Empty allows any site." }),
    booleanField({ universalIdentifier: field.requireVerifiedTravel, name: 'requireVerifiedTravel', label: "Only offer travel-checked slots", icon: 'IconRoute2' }, false),
  ],
});
