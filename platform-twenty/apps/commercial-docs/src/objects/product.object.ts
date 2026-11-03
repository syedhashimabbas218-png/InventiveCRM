import { defineObject } from 'twenty-sdk/define';

import { VAT_RATES } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { booleanField, moneyField, selectField, textField } from 'src/objects/field-builders';

const field = IDS.product.fields;

export default defineObject({
  universalIdentifier: IDS.product.object,
  nameSingular: 'product',
  namePlural: 'products',
  labelSingular: 'Product or service',
  labelPlural: 'Products and services',
  description: 'Price list used to fill quote and invoice lines.',
  icon: 'IconPackage',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: 'Name', icon: 'IconTag' }),
    textField({ universalIdentifier: field.description, name: 'description', label: 'Description on documents', icon: 'IconAlignLeft' }),
    moneyField({ universalIdentifier: field.unitPrice, name: 'unitPrice', label: 'Unit price (excl. VAT)', icon: 'IconCurrencyPound' }),
    selectField({ universalIdentifier: field.vatRate, name: 'vatRate', label: 'VAT rate', icon: 'IconReceiptTax' }, VAT_RATES, 'STANDARD_20'),
    textField({ universalIdentifier: field.unit, name: 'unit', label: 'Unit', icon: 'IconRuler', description: 'For example hour, day, item or m2.' }),
    textField({ universalIdentifier: field.sku, name: 'sku', label: 'Code', icon: 'IconBarcode' }),
    booleanField({ universalIdentifier: field.isActive, name: 'isActive', label: 'Active', icon: 'IconCheck' }, true),
  ],
});
