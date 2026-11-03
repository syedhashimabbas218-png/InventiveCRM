import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
  } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.personExtension.fields.quotes,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.RELATION,
  name: 'quotes',
  label: 'Quotes',
  icon: 'IconFileDescription',
  relationTargetObjectMetadataUniversalIdentifier: IDS.quote.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.quote.fields.person,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
