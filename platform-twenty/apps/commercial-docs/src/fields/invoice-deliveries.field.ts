import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.invoice.fields.deliveries,
  objectUniversalIdentifier: IDS.invoice.object,
  type: FieldType.RELATION,
  name: 'deliveries',
  label: 'Deliveries',
  icon: 'IconSend',
  relationTargetObjectMetadataUniversalIdentifier: IDS.delivery.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.delivery.fields.invoice,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
