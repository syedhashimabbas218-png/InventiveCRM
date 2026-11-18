import { defineView } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

const view = IDS.views.settings;
const field = IDS.settings.fields;

export default defineView({
  universalIdentifier: view.view,
  name: 'WhatsApp settings',
  objectUniversalIdentifier: IDS.settings.object,
  icon: 'IconSettings',
  position: 0,
  fields: [
    { universalIdentifier: view.fields.name, fieldMetadataUniversalIdentifier: field.name, position: 0, isVisible: true, size: 180 },
    { universalIdentifier: view.fields.displayName, fieldMetadataUniversalIdentifier: field.displayName, position: 1, isVisible: true, size: 180 },
    { universalIdentifier: view.fields.phoneNumber, fieldMetadataUniversalIdentifier: field.phoneNumber, position: 2, isVisible: true, size: 160 },
    { universalIdentifier: view.fields.autoCreatePeople, fieldMetadataUniversalIdentifier: field.autoCreatePeople, position: 3, isVisible: true, size: 200 },
    { universalIdentifier: view.fields.defaultLanguageCode, fieldMetadataUniversalIdentifier: field.defaultLanguageCode, position: 4, isVisible: true, size: 140 },
    { universalIdentifier: view.fields.gatewayTemplates, fieldMetadataUniversalIdentifier: field.gatewayTemplates, position: 5, isVisible: true, size: 300 },
    { universalIdentifier: view.fields.webhookProblem, fieldMetadataUniversalIdentifier: field.webhookProblem, position: 6, isVisible: true, size: 300 },
  ],
});
