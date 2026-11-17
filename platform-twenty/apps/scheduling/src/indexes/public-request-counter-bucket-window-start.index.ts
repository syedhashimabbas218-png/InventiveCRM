import { defineIndex } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

const index = IDS.indexes.publicRequestCounterBucketWindowStart;

// Every public request counts its client's rows in the current window.
export default defineIndex({
  universalIdentifier: index.index,
  objectUniversalIdentifier: IDS.publicRequestCounter.object,
  fields: [
    { universalIdentifier: index.fields.bucket, fieldUniversalIdentifier: IDS.publicRequestCounter.fields.bucket },
    { universalIdentifier: index.fields.windowStart, fieldUniversalIdentifier: IDS.publicRequestCounter.fields.windowStart },
  ],
});
