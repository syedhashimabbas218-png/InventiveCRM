import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.advisor.fields.bookingLinks,
  objectUniversalIdentifier: IDS.advisor.object,
  type: FieldType.RELATION,
  name: 'bookingLinks',
  label: "Booking links",
  icon: 'IconLink',
  relationTargetObjectMetadataUniversalIdentifier: IDS.bookingLink.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.bookingLink.fields.advisor,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
