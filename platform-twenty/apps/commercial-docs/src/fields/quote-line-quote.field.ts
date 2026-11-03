import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
  } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.quoteLine.fields.quote,
  objectUniversalIdentifier: IDS.quoteLine.object,
  type: FieldType.RELATION,
  name: 'quote',
  label: 'Quote',
  icon: 'IconFileDescription',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.quote.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.quote.fields.lines,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.CASCADE,
    joinColumnName: 'quoteId',
  },
});
