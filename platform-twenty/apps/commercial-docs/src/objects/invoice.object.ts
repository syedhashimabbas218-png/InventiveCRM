import { defineObject } from 'twenty-sdk/define';

import { INVOICE_KINDS, INVOICE_STATUSES, INVOICE_TEMPLATES, RECURRENCE_FREQUENCIES } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import {
  booleanField,
  dateField,
  dateTimeField,
  filesField,
  moneyField,
  numberField,
  selectField,
  textField,
} from 'src/objects/field-builders';

const field = IDS.invoice.fields;

export default defineObject({
  universalIdentifier: IDS.invoice.object,
  nameSingular: 'invoice',
  namePlural: 'invoices',
  labelSingular: 'Invoice',
  labelPlural: 'Invoices',
  description: 'An invoice or credit note. Set the status to Issued to check UK requirements, number it and file the PDF on the client card.',
  icon: 'IconFileInvoice',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: 'Invoice', icon: 'IconFileInvoice' }),
    textField({ universalIdentifier: field.invoiceNumber, name: 'invoiceNumber', label: 'Number', icon: 'IconHash' }),
    selectField({ universalIdentifier: field.kind, name: 'kind', label: 'Type', icon: 'IconFiles' }, INVOICE_KINDS, 'INVOICE'),
    selectField({ universalIdentifier: field.status, name: 'status', label: 'Status', icon: 'IconProgress' }, INVOICE_STATUSES, 'DRAFT'),
    selectField({ universalIdentifier: field.template, name: 'template', label: 'Template', icon: 'IconTemplate' }, INVOICE_TEMPLATES),
    dateField({ universalIdentifier: field.issueDate, name: 'issueDate', label: 'Invoice date', icon: 'IconCalendar' }),
    dateField({ universalIdentifier: field.supplyDate, name: 'supplyDate', label: 'Time of supply (tax point)', icon: 'IconCalendarEvent' }),
    dateField({ universalIdentifier: field.dueDate, name: 'dueDate', label: 'Due date', icon: 'IconCalendarDue' }),
    numberField({ universalIdentifier: field.paymentTermsDays, name: 'paymentTermsDays', label: 'Payment terms (days)', icon: 'IconClock' }, { integer: true }),
    textField({ universalIdentifier: field.purchaseOrderNumber, name: 'purchaseOrderNumber', label: 'Customer reference / PO', icon: 'IconReceipt' }),
    textField({ universalIdentifier: field.notes, name: 'notes', label: 'Notes', icon: 'IconNotes' }),
    moneyField({ universalIdentifier: field.subtotal, name: 'subtotal', label: 'Subtotal (excl. VAT)', icon: 'IconCurrencyPound' }),
    moneyField({ universalIdentifier: field.vatTotal, name: 'vatTotal', label: 'VAT', icon: 'IconReceiptTax' }),
    moneyField({ universalIdentifier: field.total, name: 'total', label: 'Total', icon: 'IconCurrencyPound' }),
    moneyField({ universalIdentifier: field.amountPaid, name: 'amountPaid', label: 'Amount paid', icon: 'IconCash' }),
    dateField({ universalIdentifier: field.paidDate, name: 'paidDate', label: 'Paid on', icon: 'IconCalendarCheck' }),
    filesField({ universalIdentifier: field.pdf, name: 'pdf', label: 'PDF', icon: 'IconFileTypePdf' }),
    dateTimeField({ universalIdentifier: field.lastSentAt, name: 'lastSentAt', label: 'Last sent to client', icon: 'IconSend' }),
    textField({ universalIdentifier: field.complianceIssues, name: 'complianceIssues', label: 'Issues to fix', icon: 'IconAlertTriangle' }),
    dateTimeField({ universalIdentifier: field.issuedAt, name: 'issuedAt', label: 'Issued at', icon: 'IconSend' }),
    booleanField({ universalIdentifier: field.isRecurring, name: 'isRecurring', label: 'Recurring', icon: 'IconRepeat' }, false),
    selectField({ universalIdentifier: field.recurrenceFrequency, name: 'recurrenceFrequency', label: 'Repeats', icon: 'IconRepeat' }, RECURRENCE_FREQUENCIES),
    numberField({ universalIdentifier: field.recurrenceInterval, name: 'recurrenceInterval', label: 'Repeat every', icon: 'IconRepeat', description: 'For example 2 with Monthly means every two months.' }, { integer: true, defaultValue: 1 }),
    dateField({ universalIdentifier: field.nextRecurrenceDate, name: 'nextRecurrenceDate', label: 'Next invoice date', icon: 'IconCalendarRepeat' }),
    dateField({ universalIdentifier: field.recurrenceEndDate, name: 'recurrenceEndDate', label: 'Stop repeating after', icon: 'IconCalendarOff' }),
    booleanField({ universalIdentifier: field.autoIssueRecurring, name: 'autoIssueRecurring', label: 'Issue repeats automatically', icon: 'IconSend' }, true),
  ],
});
