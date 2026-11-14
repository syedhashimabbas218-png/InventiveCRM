import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.channel.fields.messages,
  objectUniversalIdentifier: IDS.channel.object,
  type: FieldType.RELATION,
  name: 'messages',
  label: 'Messages',
  icon: 'IconMessage',
  relationTargetObjectMetadataUniversalIdentifier: IDS.message.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.message.fields.channel,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
