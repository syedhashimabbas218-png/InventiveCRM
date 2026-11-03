import { defineObject } from 'twenty-sdk/define';

import { LEGAL_STRUCTURES, REGISTERED_IN, VAT_ROUNDING } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import {
  addressField,
  booleanField,
  numberField,
  selectField,
  textField,
} from 'src/objects/field-builders';

const field = IDS.businessProfile.fields;

export default defineObject({
  universalIdentifier: IDS.businessProfile.object,
  nameSingular: 'businessProfile',
  namePlural: 'businessProfiles',
  labelSingular: 'Business profile',
  labelPlural: 'Business profiles',
  description: 'The business details printed on quotes, invoices and credit notes. Keep one record per workspace.',
  icon: 'IconBuildingStore',
  labelIdentifierFieldMetadataUniversalIdentifier: field.legalName,
  fields: [
    textField({ universalIdentifier: field.legalName, name: 'legalName', label: 'Legal name', icon: 'IconBuilding', description: 'Registered company name, or your own name if you are a sole trader.' }),
    textField({ universalIdentifier: field.tradingName, name: 'tradingName', label: 'Trading name', icon: 'IconSignature' }),
    selectField({ universalIdentifier: field.legalStructure, name: 'legalStructure', label: 'Legal structure', icon: 'IconScale' }, LEGAL_STRUCTURES, 'SOLE_TRADER'),
    textField({ universalIdentifier: field.companyNumber, name: 'companyNumber', label: 'Company number', icon: 'IconId', description: 'Companies House registration number (companies and LLPs).' }),
    selectField({ universalIdentifier: field.registeredIn, name: 'registeredIn', label: 'Registered in', icon: 'IconMap' }, REGISTERED_IN, 'ENGLAND_AND_WALES'),
    textField({ universalIdentifier: field.registeredOfficeAddress, name: 'registeredOfficeAddress', label: 'Registered office address', icon: 'IconMapPin' }),
    addressField({ universalIdentifier: field.businessAddress, name: 'businessAddress', label: 'Business address', icon: 'IconMapPin' }),
    booleanField({ universalIdentifier: field.vatRegistered, name: 'vatRegistered', label: 'VAT registered', icon: 'IconReceiptTax' }, false),
    textField({ universalIdentifier: field.vatNumber, name: 'vatNumber', label: 'VAT number', icon: 'IconReceiptTax', description: 'UK VAT registration number, e.g. GB123456789.' }),
    textField({ universalIdentifier: field.email, name: 'email', label: 'Accounts email', icon: 'IconMail' }),
    textField({ universalIdentifier: field.phone, name: 'phone', label: 'Phone', icon: 'IconPhone' }),
    textField({ universalIdentifier: field.website, name: 'website', label: 'Website', icon: 'IconWorld' }),
    textField({ universalIdentifier: field.bankName, name: 'bankName', label: 'Bank name', icon: 'IconBuildingBank' }),
    textField({ universalIdentifier: field.bankAccountName, name: 'bankAccountName', label: 'Bank account name', icon: 'IconUser' }),
    textField({ universalIdentifier: field.sortCode, name: 'sortCode', label: 'Sort code', icon: 'IconHash' }),
    textField({ universalIdentifier: field.accountNumber, name: 'accountNumber', label: 'Account number', icon: 'IconHash' }),
    textField({ universalIdentifier: field.iban, name: 'iban', label: 'IBAN', icon: 'IconHash' }),
    textField({ universalIdentifier: field.bic, name: 'bic', label: 'BIC', icon: 'IconHash' }),
    textField({ universalIdentifier: field.invoicePrefix, name: 'invoicePrefix', label: 'Invoice number prefix', icon: 'IconHash' }),
    textField({ universalIdentifier: field.quotePrefix, name: 'quotePrefix', label: 'Quote number prefix', icon: 'IconHash' }),
    textField({ universalIdentifier: field.creditNotePrefix, name: 'creditNotePrefix', label: 'Credit note number prefix', icon: 'IconHash' }),
    numberField({ universalIdentifier: field.nextInvoiceNumber, name: 'nextInvoiceNumber', label: 'Next invoice number', icon: 'IconListNumbers' }, { integer: true, defaultValue: 1 }),
    numberField({ universalIdentifier: field.nextQuoteNumber, name: 'nextQuoteNumber', label: 'Next quote number', icon: 'IconListNumbers' }, { integer: true, defaultValue: 1 }),
    numberField({ universalIdentifier: field.nextCreditNoteNumber, name: 'nextCreditNoteNumber', label: 'Next credit note number', icon: 'IconListNumbers' }, { integer: true, defaultValue: 1 }),
    numberField({ universalIdentifier: field.numberPadding, name: 'numberPadding', label: 'Number of digits', icon: 'IconListNumbers' }, { integer: true, defaultValue: 4 }),
    numberField({ universalIdentifier: field.defaultPaymentTermsDays, name: 'defaultPaymentTermsDays', label: 'Payment terms (days)', icon: 'IconCalendarDue' }, { integer: true, defaultValue: 30 }),
    numberField({ universalIdentifier: field.quoteValidityDays, name: 'quoteValidityDays', label: 'Quotes valid for (days)', icon: 'IconCalendar' }, { integer: true, defaultValue: 30 }),
    selectField({ universalIdentifier: field.vatRounding, name: 'vatRounding', label: 'VAT rounding', icon: 'IconMathFunction' }, VAT_ROUNDING, 'NEAREST_PENNY'),
    textField({ universalIdentifier: field.paymentInstructions, name: 'paymentInstructions', label: 'Payment instructions', icon: 'IconCreditCard' }),
    textField({ universalIdentifier: field.invoiceFooter, name: 'invoiceFooter', label: 'Footer text', icon: 'IconAlignLeft' }),
    booleanField({ universalIdentifier: field.includeLatePaymentNotice, name: 'includeLatePaymentNotice', label: 'Show late payment notice', icon: 'IconAlertTriangle' }, true),
  ],
});
