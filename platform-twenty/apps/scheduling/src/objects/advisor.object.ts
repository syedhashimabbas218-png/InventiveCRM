import { defineObject } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { booleanField, jsonField, numberField, textField } from 'src/objects/field-builders';

const field = IDS.advisor.fields;

export default defineObject({
  universalIdentifier: IDS.advisor.object,
  nameSingular: 'advisor',
  namePlural: 'advisors',
  labelSingular: "Advisor",
  labelPlural: "Advisors",
  description: "A person who takes appointments: working hours, locations, territories and booking rules.",
  icon: 'IconUserCircle',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: "Name", icon: 'IconUser' }),
    textField({ universalIdentifier: field.workspaceMemberId, name: 'workspaceMemberId', label: "Twenty user (workspace member id)", icon: 'IconUserCheck', description: "Links the advisor to their Twenty login and calendar connections." }),
    textField({ universalIdentifier: field.email, name: 'email', label: "Email", icon: 'IconMail' }),
    textField({ universalIdentifier: field.phone, name: 'phone', label: "Phone", icon: 'IconPhone' }),
    textField({ universalIdentifier: field.timeZone, name: 'timeZone', label: "Time zone", icon: 'IconWorld', description: "IANA name, e.g. Europe/London." }),
    booleanField({ universalIdentifier: field.isActive, name: 'isActive', label: "Active", icon: 'IconCheck' }, true),
    textField({ universalIdentifier: field.publicBio, name: 'publicBio', label: "Public bio", icon: 'IconAlignLeft' }),
    textField({ universalIdentifier: field.bookingSlug, name: 'bookingSlug', label: "Personal booking slug", icon: 'IconLink', isUnique: true }),
    numberField({ universalIdentifier: field.weight, name: 'weight', label: "Round-robin weight", icon: 'IconScale' }, { integer: true, defaultValue: 1 }),
    numberField({ universalIdentifier: field.priority, name: 'priority', label: "Round-robin priority", icon: 'IconSortDescending' }, { integer: true, defaultValue: 0 }),
    numberField({ universalIdentifier: field.dailyLimit, name: 'dailyLimit', label: "Daily booking limit", icon: 'IconCalendarStats' }, { integer: true }),
    numberField({ universalIdentifier: field.weeklyLimit, name: 'weeklyLimit', label: "Weekly booking limit", icon: 'IconCalendarStats' }, { integer: true }),
    booleanField({ universalIdentifier: field.inPerson, name: 'inPerson', label: "Meets in person", icon: 'IconBuildingStore' }, true),
    booleanField({ universalIdentifier: field.remote, name: 'remote', label: "Meets remotely", icon: 'IconVideo' }, true),
    booleanField({ universalIdentifier: field.travelsToCustomers, name: 'travelsToCustomers', label: "Travels to customers", icon: 'IconCar' }, false),
    textField({ universalIdentifier: field.baseAddress, name: 'baseAddress', label: "Base address (private)", icon: 'IconHome' }),
    numberField({ universalIdentifier: field.baseLatitude, name: 'baseLatitude', label: "Base latitude", icon: 'IconMapPin' }, { decimals: 6 }),
    numberField({ universalIdentifier: field.baseLongitude, name: 'baseLongitude', label: "Base longitude", icon: 'IconMapPin' }, { decimals: 6 }),
    textField({ universalIdentifier: field.publicLocationLabel, name: 'publicLocationLabel', label: "Public location label", icon: 'IconMapPin', description: "What customers see instead of the exact base address, e.g. North Leeds." }),
    numberField({ universalIdentifier: field.serviceRadiusKm, name: 'serviceRadiusKm', label: "Service radius (km)", icon: 'IconCircleDashed' }, { decimals: 6 }),
    numberField({ universalIdentifier: field.maxTravelMinutes, name: 'maxTravelMinutes', label: "Maximum travel time (minutes)", icon: 'IconClock' }, { integer: true }),
    numberField({ universalIdentifier: field.travelBufferMinutes, name: 'travelBufferMinutes', label: "Travel buffer (minutes)", icon: 'IconHourglass' }, { integer: true, defaultValue: 10 }),
    textField({ universalIdentifier: field.postcodeTerritory, name: 'postcodeTerritory', label: "Postcode territory", icon: 'IconMap', description: "Comma separated postcode areas or districts, e.g. LS, BD1, HG2." }),
    jsonField({ universalIdentifier: field.serviceArea, name: 'serviceArea', label: "Service area (GeoJSON)", icon: 'IconPolygon' }),
  ],
});
