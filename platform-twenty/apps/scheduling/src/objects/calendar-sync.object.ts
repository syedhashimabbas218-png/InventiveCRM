import { defineObject } from 'twenty-sdk/define';

import { PROVIDERS, SYNC_OPERATIONS, SYNC_STATUSES } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { dateTimeField, numberField, selectField, textField } from 'src/objects/field-builders';

const field = IDS.calendarSync.fields;

export default defineObject({
  universalIdentifier: IDS.calendarSync.object,
  nameSingular: 'calendarSync',
  namePlural: 'calendarSyncs',
  labelSingular: "Calendar sync",
  labelPlural: "Calendar syncs",
  description: "Outbox of calendar writes per appointment and calendar, retried until they succeed.",
  icon: 'IconRefresh',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: "Name", icon: 'IconTag' }),
    selectField({ universalIdentifier: field.provider, name: 'provider', label: "Provider", icon: 'IconBrandGoogle' }, PROVIDERS),
    textField({ universalIdentifier: field.connectionId, name: 'connectionId', label: "Connection id", icon: 'IconKey' }),
    textField({ universalIdentifier: field.calendarId, name: 'calendarId', label: "Calendar id", icon: 'IconCalendar' }),
    textField({ universalIdentifier: field.externalEventId, name: 'externalEventId', label: "External event id", icon: 'IconExternalLink' }),
    selectField({ universalIdentifier: field.operation, name: 'operation', label: "Pending change", icon: 'IconPencil' }, SYNC_OPERATIONS, 'UPSERT'),
    selectField({ universalIdentifier: field.status, name: 'status', label: "Status", icon: 'IconProgressCheck' }, SYNC_STATUSES, 'PENDING'),
    numberField({ universalIdentifier: field.attempts, name: 'attempts', label: "Attempts", icon: 'IconRepeat' }, { integer: true, defaultValue: 0 }),
    dateTimeField({ universalIdentifier: field.nextAttemptAt, name: 'nextAttemptAt', label: "Next attempt", icon: 'IconClock' }),
    textField({ universalIdentifier: field.lastError, name: 'lastError', label: "Last error", icon: 'IconAlertTriangle' }),
    dateTimeField({ universalIdentifier: field.syncedAt, name: 'syncedAt', label: "Synced at", icon: 'IconCheck' }),
    textField({ universalIdentifier: field.externalUpdatedAt, name: 'externalUpdatedAt', label: "Provider version", icon: 'IconVersions' }),
  ],
});
