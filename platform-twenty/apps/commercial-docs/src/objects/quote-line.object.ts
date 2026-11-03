import { defineObject } from 'twenty-sdk/define';

import { VAT_RATES } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { moneyField, numberField, selectField, textField } from 'src/objects/field-builders';

const field = IDS.quoteLine.fields;

export default defineObject({
  universalIdentifier: IDS.quoteLine.object,
  nameSingular: 'quoteLine',
  namePlural: 'quoteLines',
  labelSingular: 'Quote line',
  labelPlural: 'Quote lines',
  description: 'A line on a quote. Pick a product to fill the description, price and VAT rate; net and VAT amounts are calculated.',
  icon: 'IconListDetails',
  labelIdentifierFieldMetadataUniversalIdentifier: field.description,
  fields: [
    textField({ universalIdentifier: field.description, name: 'description', label: 'Description', icon: 'IconAlignLeft' }),
    numberField({ universalIdentifier: field.quantity, name: 'quantity', label: 'Quantity', icon: 'IconHash' }, { defaultValue: 1 }),
    textField({ universalIdentifier: field.unit, name: 'unit', label: 'Unit', icon: 'IconRuler' }),
    moneyField({ universalIdentifier: field.unitPrice, name: 'unitPrice', label: 'Unit price (excl. VAT)', icon: 'IconCurrencyPound' }),
    selectField({ universalIdentifier: field.vatRate, name: 'vatRate', label: 'VAT rate', icon: 'IconReceiptTax' }, VAT_RATES),
    numberField({ universalIdentifier: field.discountPercent, name: 'discountPercent', label: 'Discount %', icon: 'IconDiscount' }, { defaultValue: 0 }),
    moneyField({ universalIdentifier: field.netAmount, name: 'netAmount', label: 'Net amount', icon: 'IconCurrencyPound' }),
    moneyField({ universalIdentifier: field.vatAmount, name: 'vatAmount', label: 'VAT amount', icon: 'IconReceiptTax' }),
    numberField({ universalIdentifier: field.position, name: 'lineOrder', label: 'Order', icon: 'IconSortAscending' }, { integer: true, defaultValue: 0 }),
  ],
});
