import {
  defineField,
  FieldType,
  RelationType,
  } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.quote.fields.lines,
  objectUniversalIdentifier: IDS.quote.object,
  type: FieldType.RELATION,
  name: 'lines',
  label: 'Lines',
  icon: 'IconListDetails',
  relationTargetObjectMetadataUniversalIdentifier: IDS.quoteLine.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.quoteLine.fields.quote,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
