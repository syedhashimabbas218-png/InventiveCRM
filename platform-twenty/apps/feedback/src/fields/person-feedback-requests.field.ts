import { defineField, FieldType, RelationType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.personExtension.fields.feedbackRequests,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.RELATION,
  name: 'feedbackRequests',
  label: 'Feedback',
  icon: 'IconMoodSmile',
  relationTargetObjectMetadataUniversalIdentifier: IDS.request.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.request.fields.person,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
