import { defineIndex } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

const index = IDS.indexes.appointmentSessionKey;

// Group session members are looked up by session on every calendar sync and seat release.
export default defineIndex({
  universalIdentifier: index.index,
  objectUniversalIdentifier: IDS.appointment.object,
  fields: [{ universalIdentifier: index.fields.sessionKey, fieldUniversalIdentifier: IDS.appointment.fields.sessionKey }],
});
