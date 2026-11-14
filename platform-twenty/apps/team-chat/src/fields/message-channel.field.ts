import { defineField, FieldType, OnDeleteAction, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.message.fields.channel,
  objectUniversalIdentifier: IDS.message.object,
  type: FieldType.RELATION,
  name: 'channel',
  label: 'Channel',
  icon: 'IconMessages',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.channel.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.channel.fields.messages,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.CASCADE,
    joinColumnName: 'channelId',
  },
});
