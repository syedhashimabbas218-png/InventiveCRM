import { defineObject } from 'twenty-sdk/define';

import { TEMPLATE_DOCUMENT_TYPES, TEMPLATE_FORMATS, TEMPLATE_STATUSES, TEMPLATE_VAT_SCHEMES } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { booleanField, dateTimeField, filesField, numberField, selectField, textField } from 'src/objects/field-builders';

const field = IDS.documentTemplate.fields;

export default defineObject({
  universalIdentifier: IDS.documentTemplate.object,
  nameSingular: 'documentTemplate',
  namePlural: 'documentTemplates',
  labelSingular: 'Document template',
  labelPlural: 'Document templates',
  description: "The business's own invoice, credit note and quote designs (Word or PDF). The right one is picked by rules when a document is issued.",
  icon: 'IconTemplate',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: 'Name', icon: 'IconTag' }),
    filesField({ universalIdentifier: field.file, name: 'file', label: 'Template file (.docx or .pdf)', icon: 'IconFileUpload' }),
    selectField({ universalIdentifier: field.documentType, name: 'documentType', label: 'Use for', icon: 'IconFileInvoice' }, TEMPLATE_DOCUMENT_TYPES, 'AUTO'),
    selectField({ universalIdentifier: field.vatScheme, name: 'vatScheme', label: 'VAT', icon: 'IconReceiptTax' }, TEMPLATE_VAT_SCHEMES, 'AUTO'),
    selectField({ universalIdentifier: field.format, name: 'format', label: 'Format', icon: 'IconFileText' }, TEMPLATE_FORMATS),
    selectField({ universalIdentifier: field.status, name: 'status', label: 'Status', icon: 'IconProgressCheck' }, TEMPLATE_STATUSES, 'CHECKING'),
    booleanField({ universalIdentifier: field.isActive, name: 'isActive', label: 'Active', icon: 'IconCheck' }, true),
    numberField({ universalIdentifier: field.priority, name: 'priority', label: 'Priority', icon: 'IconSortDescending', description: 'When several templates match, the higher number wins.' }, { integer: true, defaultValue: 0 }),
    numberField({ universalIdentifier: field.headerHeightMm, name: 'headerHeightMm', label: 'Letterhead header (mm)', icon: 'IconLayoutNavbar', description: 'Space kept clear at the top of a PDF letterhead. Measured automatically; edit to adjust.' }, { integer: true }),
    numberField({ universalIdentifier: field.footerHeightMm, name: 'footerHeightMm', label: 'Letterhead footer (mm)', icon: 'IconLayoutBottombar', description: 'Space kept clear at the bottom of a PDF letterhead.' }, { integer: true }),
    numberField({ universalIdentifier: field.lineRows, name: 'lineRows', label: 'Form line rows', icon: 'IconListNumbers' }, { integer: true }),
    textField({ universalIdentifier: field.checkReport, name: 'checkReport', label: 'Check report', icon: 'IconListCheck' }),
    textField({ universalIdentifier: field.readBy, name: 'readBy', label: 'Read from', icon: 'IconScan' }),
    dateTimeField({ universalIdentifier: field.checkedAt, name: 'checkedAt', label: 'Checked at', icon: 'IconClock' }),
  ],
});
