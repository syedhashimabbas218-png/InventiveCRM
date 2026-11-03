import { defineObject } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { dateTimeField, numberField, textField } from 'src/objects/field-builders';

const field = IDS.publicRequestCounter.fields;

export default defineObject({
  universalIdentifier: IDS.publicRequestCounter.object,
  nameSingular: 'publicRequestCounter',
  namePlural: 'publicRequestCounters',
  labelSingular: "Public request counter",
  labelPlural: "Public request counters",
  description: "Rate-limit counters for the public booking pages (hashed client address per minute).",
  icon: 'IconGauge',
  labelIdentifierFieldMetadataUniversalIdentifier: field.key,
  fields: [
    textField({ universalIdentifier: field.key, name: 'key', label: "Key", icon: 'IconKey', isUnique: true }),
    numberField({ universalIdentifier: field.count, name: 'count', label: "Requests", icon: 'IconHash' }, { integer: true, defaultValue: 0 }),
    dateTimeField({ universalIdentifier: field.windowStart, name: 'windowStart', label: "Window", icon: 'IconClock' }),
  ],
});
