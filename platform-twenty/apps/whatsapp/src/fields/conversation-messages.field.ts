import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.conversation.fields.messages,
  objectUniversalIdentifier: IDS.conversation.object,
  type: FieldType.RELATION,
  name: 'messages',
  label: 'Messages',
  icon: 'IconMessageCircle',
  relationTargetObjectMetadataUniversalIdentifier: IDS.message.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.message.fields.conversation,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
