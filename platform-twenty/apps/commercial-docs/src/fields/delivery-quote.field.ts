import { defineField, FieldType, OnDeleteAction, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.delivery.fields.quote,
  objectUniversalIdentifier: IDS.delivery.object,
  type: FieldType.RELATION,
  name: 'quote',
  label: 'Quote',
  icon: 'IconFileDescription',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.quote.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.quote.fields.deliveries,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.CASCADE,
    joinColumnName: 'quoteId',
  },
});
