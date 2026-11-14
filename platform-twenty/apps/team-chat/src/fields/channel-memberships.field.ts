import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.channel.fields.memberships,
  objectUniversalIdentifier: IDS.channel.object,
  type: FieldType.RELATION,
  name: 'memberships',
  label: 'Members',
  icon: 'IconUsers',
  relationTargetObjectMetadataUniversalIdentifier: IDS.membership.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.membership.fields.channel,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
