import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.campaign.fields.recipients,
  objectUniversalIdentifier: IDS.campaign.object,
  type: FieldType.RELATION,
  name: 'recipients',
  label: 'Recipients',
  icon: 'IconUsers',
  relationTargetObjectMetadataUniversalIdentifier: IDS.recipient.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.recipient.fields.campaign,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
