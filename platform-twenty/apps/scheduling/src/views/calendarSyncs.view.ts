import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.calendarSyncs,
  name: "Calendar sync queue",
  objectUniversalIdentifier: IDS.calendarSync.object,
  icon: 'IconRefresh',
  position: 0,
  fields: [
    {
      universalIdentifier: '8b20fac9-abfc-4b58-bab2-0a455499479e',
      fieldMetadataUniversalIdentifier: IDS.calendarSync.fields.name,
      position: 0,
      isVisible: true,
      size: 240,
    },
    {
      universalIdentifier: '7f515244-0e13-45a1-a664-e69a3044cb5d',
      fieldMetadataUniversalIdentifier: IDS.calendarSync.fields.status,
      position: 1,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '8d20937d-4ac3-4824-a200-c4c1c170bb6c',
      fieldMetadataUniversalIdentifier: IDS.calendarSync.fields.operation,
      position: 2,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'ebd862ac-d239-4fac-bb6b-4d7ee892cb8d',
      fieldMetadataUniversalIdentifier: IDS.calendarSync.fields.attempts,
      position: 3,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '3ad484fa-7c0f-449b-983f-b19e2ef29fe0',
      fieldMetadataUniversalIdentifier: IDS.calendarSync.fields.nextAttemptAt,
      position: 4,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'd1c6be89-1213-4104-8c8b-2a7c71ad9283',
      fieldMetadataUniversalIdentifier: IDS.calendarSync.fields.lastError,
      position: 5,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: 'ab691b57-71f2-4fa4-8cde-f8f2d6491f15',
      fieldMetadataUniversalIdentifier: IDS.calendarSync.fields.provider,
      position: 6,
      isVisible: true,
      size: 160,
    },
  ],
});
