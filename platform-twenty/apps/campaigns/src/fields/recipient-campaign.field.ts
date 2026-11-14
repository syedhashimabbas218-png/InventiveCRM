import { defineField, FieldType, OnDeleteAction, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.recipient.fields.campaign,
  objectUniversalIdentifier: IDS.recipient.object,
  type: FieldType.RELATION,
  name: 'campaign',
  label: 'Campaign',
  icon: 'IconSpeakerphone',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.campaign.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.campaign.fields.recipients,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.CASCADE,
    joinColumnName: 'campaignId',
  },
});
