import { defineObject } from 'twenty-sdk/define';

import { QUOTE_STATUSES } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { dateField, dateTimeField, filesField, moneyField, selectField, textField } from 'src/objects/field-builders';

const field = IDS.quote.fields;

export default defineObject({
  universalIdentifier: IDS.quote.object,
  nameSingular: 'quote',
  namePlural: 'quotes',
  labelSingular: 'Quote',
  labelPlural: 'Quotes',
  description: 'A priced quotation for a client. Set the status to Sent to number it and file the PDF on the client card; Accepted turns it into a draft invoice.',
  icon: 'IconFileDescription',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: 'Quote', icon: 'IconFileDescription' }),
    textField({ universalIdentifier: field.quoteNumber, name: 'quoteNumber', label: 'Quote number', icon: 'IconHash' }),
    selectField({ universalIdentifier: field.status, name: 'status', label: 'Status', icon: 'IconProgress' }, QUOTE_STATUSES, 'DRAFT'),
    dateField({ universalIdentifier: field.issueDate, name: 'issueDate', label: 'Quote date', icon: 'IconCalendar' }),
    dateField({ universalIdentifier: field.validUntil, name: 'validUntil', label: 'Valid until', icon: 'IconCalendarDue' }),
    textField({ universalIdentifier: field.title, name: 'title', label: 'Job or project', icon: 'IconBriefcase' }),
    textField({ universalIdentifier: field.notes, name: 'notes', label: 'Notes', icon: 'IconNotes' }),
    textField({ universalIdentifier: field.terms, name: 'terms', label: 'Terms', icon: 'IconFileText' }),
    moneyField({ universalIdentifier: field.subtotal, name: 'subtotal', label: 'Subtotal (excl. VAT)', icon: 'IconCurrencyPound' }),
    moneyField({ universalIdentifier: field.vatTotal, name: 'vatTotal', label: 'VAT', icon: 'IconReceiptTax' }),
    moneyField({ universalIdentifier: field.total, name: 'total', label: 'Total', icon: 'IconCurrencyPound' }),
    filesField({ universalIdentifier: field.pdf, name: 'pdf', label: 'PDF', icon: 'IconFileTypePdf' }),
    dateTimeField({ universalIdentifier: field.lastSentAt, name: 'lastSentAt', label: 'Last sent to client', icon: 'IconSend' }),
    textField({ universalIdentifier: field.layoutUsed, name: 'layoutUsed', label: 'Layout used', icon: 'IconTemplate', description: 'Which template was picked for the PDF, and why.' }),
    textField({ universalIdentifier: field.complianceIssues, name: 'complianceIssues', label: 'Issues to fix', icon: 'IconAlertTriangle' }),
    dateTimeField({ universalIdentifier: field.sentAt, name: 'sentAt', label: 'Sent at', icon: 'IconSend' }),
  ],
});
