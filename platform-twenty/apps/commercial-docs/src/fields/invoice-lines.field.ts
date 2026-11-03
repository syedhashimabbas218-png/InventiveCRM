import {
  defineField,
  FieldType,
  RelationType,
  } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.invoice.fields.lines,
  objectUniversalIdentifier: IDS.invoice.object,
  type: FieldType.RELATION,
  name: 'lines',
  label: 'Lines',
  icon: 'IconListDetails',
  relationTargetObjectMetadataUniversalIdentifier: IDS.invoiceLine.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.invoiceLine.fields.invoice,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
