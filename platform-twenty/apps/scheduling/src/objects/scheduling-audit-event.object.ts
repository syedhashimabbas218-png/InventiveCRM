import { defineObject } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { dateTimeField, jsonField, textField } from 'src/objects/field-builders';

const field = IDS.schedulingAuditEvent.fields;

export default defineObject({
  universalIdentifier: IDS.schedulingAuditEvent.object,
  nameSingular: 'schedulingAuditEvent',
  namePlural: 'schedulingAuditEvents',
  labelSingular: "Scheduling audit event",
  labelPlural: "Scheduling audit events",
  description: "Who changed an appointment, when and how.",
  icon: 'IconHistory',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: "Action", icon: 'IconTag' }),
    textField({ universalIdentifier: field.actor, name: 'actor', label: "By", icon: 'IconUser' }),
    jsonField({ universalIdentifier: field.details, name: 'details', label: "Details", icon: 'IconJson' }),
    dateTimeField({ universalIdentifier: field.occurredAt, name: 'occurredAt', label: "At", icon: 'IconClock' }),
  ],
});
