import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.quote.fields.deliveries,
  objectUniversalIdentifier: IDS.quote.object,
  type: FieldType.RELATION,
  name: 'deliveries',
  label: 'Deliveries',
  icon: 'IconSend',
  relationTargetObjectMetadataUniversalIdentifier: IDS.delivery.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.delivery.fields.quote,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
