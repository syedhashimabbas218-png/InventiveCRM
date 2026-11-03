import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.bookingLinks,
  name: "Booking links",
  objectUniversalIdentifier: IDS.bookingLink.object,
  icon: 'IconLink',
  position: 0,
  fields: [
    {
      universalIdentifier: '66f0aa27-2805-4270-a7c5-91cc436779d7',
      fieldMetadataUniversalIdentifier: IDS.bookingLink.fields.name,
      position: 0,
      isVisible: true,
      size: 240,
    },
    {
      universalIdentifier: 'ba74de11-78ff-488f-a202-fb004cf7cf1e',
      fieldMetadataUniversalIdentifier: IDS.bookingLink.fields.slug,
      position: 1,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '9e71a5e8-40cd-4a94-8cc1-ab4fe32be32b',
      fieldMetadataUniversalIdentifier: IDS.bookingLink.fields.isActive,
      position: 2,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '8992a823-6cf8-4dc1-afeb-e65aa7980b65',
      fieldMetadataUniversalIdentifier: IDS.bookingLink.fields.appointmentType,
      position: 3,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '2c4eff76-cba0-453e-a8bb-a28580566658',
      fieldMetadataUniversalIdentifier: IDS.bookingLink.fields.advisor,
      position: 4,
      isVisible: true,
      size: 160,
    },
  ],
});
