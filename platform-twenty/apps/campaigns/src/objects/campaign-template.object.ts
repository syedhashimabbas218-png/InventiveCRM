import { defineObject } from 'twenty-sdk/define';

import { TEMPLATE_CATEGORIES } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { dateTimeField, jsonField, numberField, selectField, textField } from 'src/objects/field-builders';

const field = IDS.template.fields;

export default defineObject({
  universalIdentifier: IDS.template.object,
  nameSingular: 'campaignTemplate',
  namePlural: 'campaignTemplates',
  labelSingular: 'Email template',
  labelPlural: 'Email templates',
  description: 'A saved email design to start campaigns from.',
  icon: 'IconTemplate',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: 'Name', icon: 'IconTag' }),
    selectField({ universalIdentifier: field.category, name: 'category', label: 'Category', icon: 'IconCategory' }, TEMPLATE_CATEGORIES, 'OTHER'),
    textField({ universalIdentifier: field.description, name: 'description', label: 'Description', icon: 'IconNote' }),
    jsonField({ universalIdentifier: field.design, name: 'design', label: 'Design', icon: 'IconLayout' }),
  ],
});
