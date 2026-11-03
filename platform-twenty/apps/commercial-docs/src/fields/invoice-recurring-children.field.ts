import {
  defineField,
  FieldType,
  RelationType,
  } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.invoice.fields.recurringChildren,
  objectUniversalIdentifier: IDS.invoice.object,
  type: FieldType.RELATION,
  name: 'recurringChildren',
  label: 'Repeat invoices',
  icon: 'IconRepeat',
  relationTargetObjectMetadataUniversalIdentifier: IDS.invoice.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.invoice.fields.recurringParent,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
