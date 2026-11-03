import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineView({
  universalIdentifier: IDS.views.invoices,
  name: 'All invoices',
  objectUniversalIdentifier: IDS.invoice.object,
  icon: 'IconFileInvoice',
  position: 0,
  fields: [
    {
      universalIdentifier: '716c8771-ec70-4de5-b9be-5f24584fc818',
      fieldMetadataUniversalIdentifier: IDS.invoice.fields.name,
      position: 0,
      isVisible: true,
      size: 260,
    },
    {
      universalIdentifier: 'fc2bc9f6-07d8-497f-9263-d4947a9a21e0',
      fieldMetadataUniversalIdentifier: IDS.invoice.fields.status,
      position: 1,
      isVisible: true,
      size: 110,
    },
    {
      universalIdentifier: '485c1e9b-1366-46df-8e27-98ec5e850baa',
      fieldMetadataUniversalIdentifier: IDS.invoice.fields.company,
      position: 2,
      isVisible: true,
      size: 200,
    },
    {
      universalIdentifier: 'fc5d1ef7-aaf5-4c7a-b1cb-5f791f60130d',
      fieldMetadataUniversalIdentifier: IDS.invoice.fields.total,
      position: 3,
      isVisible: true,
      size: 120,
    },
    {
      universalIdentifier: '56dda460-72d3-4a64-bffe-4c2f89daf792',
      fieldMetadataUniversalIdentifier: IDS.invoice.fields.dueDate,
      position: 4,
      isVisible: true,
      size: 120,
    },
    {
      universalIdentifier: 'a091a3b3-49d9-4786-8c6e-96bf3fbc89d4',
      fieldMetadataUniversalIdentifier: IDS.invoice.fields.issueDate,
      position: 5,
      isVisible: true,
      size: 120,
    },
    {
      universalIdentifier: '8b55b923-7f80-4a46-a2dd-d83415bcc1ef',
      fieldMetadataUniversalIdentifier: IDS.invoice.fields.kind,
      position: 6,
      isVisible: true,
      size: 110,
    },
    {
      universalIdentifier: '17d8c2a0-c79f-4c08-988a-f7a6d9e10698',
      fieldMetadataUniversalIdentifier: IDS.invoice.fields.isRecurring,
      position: 7,
      isVisible: true,
      size: 100,
    },
  ],
});
