import { defineObject } from 'twenty-sdk/define';

import { CONTACT_MATCHING } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { booleanField, numberField, selectField, textField } from 'src/objects/field-builders';

const field = IDS.schedulingSettings.fields;

export default defineObject({
  universalIdentifier: IDS.schedulingSettings.object,
  nameSingular: 'schedulingSettings',
  namePlural: 'schedulingSettingsRecords',
  labelSingular: "Scheduling settings",
  labelPlural: "Scheduling settings",
  description: "Workspace scheduling policy. The oldest record is used.",
  icon: 'IconSettings',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: "Name", icon: 'IconTag' }),
    selectField({ universalIdentifier: field.contactMatching, name: 'contactMatching', label: "Match customers to contacts by", icon: 'IconUserSearch' }, CONTACT_MATCHING, 'EMAIL'),
    booleanField({ universalIdentifier: field.createContacts, name: 'createContacts', label: "Create contacts for new customers", icon: 'IconUserPlus' }, true),
    booleanField({ universalIdentifier: field.linkCompanyByEmailDomain, name: 'linkCompanyByEmailDomain', label: "Link to the company with the email domain", icon: 'IconBuilding' }, true),
    numberField({ universalIdentifier: field.maxAppointmentTypes, name: 'maxAppointmentTypes', label: "Maximum appointment types", icon: 'IconListNumbers' }, { integer: true }),
    textField({ universalIdentifier: field.defaultTimeZone, name: 'defaultTimeZone', label: "Default time zone", icon: 'IconWorld' }, "Europe/London"),
    textField({ universalIdentifier: field.senderName, name: 'senderName', label: "Email sender name", icon: 'IconMail' }),
    booleanField({ universalIdentifier: field.notifyAdvisors, name: 'notifyAdvisors', label: "Email advisors about bookings", icon: 'IconBell' }, true),
    numberField({ universalIdentifier: field.bookingsPerHourPerClient, name: 'bookingsPerHourPerClient', label: "Bookings per hour per client address", icon: 'IconGauge' }, { integer: true, defaultValue: 10 }),
  ],
});
