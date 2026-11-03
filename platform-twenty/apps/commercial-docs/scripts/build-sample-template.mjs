// Writes templates/sample-uk-vat-invoice.docx: a starting point for a business's own Word invoice template.
import { writeFileSync } from 'node:fs';

import PizZip from 'pizzip';

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const run = (text, { bold = false, size = 20, color } = {}) =>
  `<w:r><w:rPr>${bold ? '<w:b/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escape(text)}</w:t></w:r>`;
const paragraph = (runs, { align, spacingAfter = 60 } = {}) =>
  `<w:p><w:pPr>${align ? `<w:jc w:val="${align}"/>` : ''}<w:spacing w:after="${spacingAfter}"/></w:pPr>${[].concat(runs).join('')}</w:p>`;
const cell = (content, width, { align, shade } = {}) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade ? `<w:shd w:val="clear" w:fill="${shade}"/>` : ''}</w:tcPr>${paragraph(content, { align, spacingAfter: 0 })}</w:tc>`;
const row = (cells) => `<w:tr>${cells.join('')}</w:tr>`;
const table = (rows, widths) =>
  `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((sum, width) => sum + width, 0)}" w:type="dxa"/><w:tblBorders><w:insideH w:val="single" w:sz="4" w:color="DDDDDD"/></w:tblBorders></w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`;

const muted = { size: 18, color: '666666' };
const body = [
  paragraph(run('{documentTitle}', { bold: true, size: 40 }), { spacingAfter: 200 }),
  paragraph(run('{sellerName}', { bold: true, size: 24 })),
  paragraph(run('{sellerAddress}', muted)),
  paragraph(run('VAT registration no. {sellerVatNumber}', muted)),
  paragraph(run('{sellerEmail}  {sellerPhone}', muted), { spacingAfter: 240 }),
  table(
    [
      row([cell(run('BILL TO', { bold: true, ...muted }), 4600), cell(run('Invoice number', { bold: true, ...muted }), 2200), cell(run('{documentNumber}'), 2200, { align: 'right' })]),
      row([cell(run('{customerName}', { bold: true }), 4600), cell(run('Invoice date', { bold: true, ...muted }), 2200), cell(run('{issueDate}'), 2200, { align: 'right' })]),
      row([cell(run('{customerAddress}'), 4600), cell(run('Tax point', { bold: true, ...muted }), 2200), cell(run('{supplyDate}'), 2200, { align: 'right' })]),
      row([cell(run('{#customerVatNumber}VAT no. {customerVatNumber}{/customerVatNumber}', muted), 4600), cell(run('Payment due', { bold: true, ...muted }), 2200), cell(run('{dueDate}'), 2200, { align: 'right' })]),
      row([cell(run(''), 4600), cell(run('Your reference', { bold: true, ...muted }), 2200), cell(run('{purchaseOrderNumber}'), 2200, { align: 'right' })]),
    ],
    [4600, 2200, 2200],
  ),
  paragraph(run(''), { spacingAfter: 200 }),
  table(
    [
      row([
        cell(run('Description', { bold: true, size: 18 }), 4200, { shade: 'F2F2F4' }),
        cell(run('Qty', { bold: true, size: 18 }), 1100, { align: 'right', shade: 'F2F2F4' }),
        cell(run('Unit price', { bold: true, size: 18 }), 1300, { align: 'right', shade: 'F2F2F4' }),
        cell(run('VAT', { bold: true, size: 18 }), 900, { align: 'right', shade: 'F2F2F4' }),
        cell(run('Amount', { bold: true, size: 18 }), 1500, { align: 'right', shade: 'F2F2F4' }),
      ]),
      row([
        cell(run('{#lines}{description}'), 4200),
        cell(run('{quantity}'), 1100, { align: 'right' }),
        cell(run('{unitPrice}'), 1300, { align: 'right' }),
        cell(run('{vatRate}'), 900, { align: 'right' }),
        cell(run('{lineNet}{/lines}'), 1500, { align: 'right' }),
      ]),
    ],
    [4200, 1100, 1300, 900, 1500],
  ),
  paragraph(run(''), { spacingAfter: 120 }),
  table(
    [
      row([cell(run('{#summaryRows}{label}', muted), 6000, { align: 'right' }), cell(run('{amount}{/summaryRows}'), 3000, { align: 'right' })]),
      row([cell(run('{totalLabel}', { bold: true, size: 24 }), 6000, { align: 'right' }), cell(run('{total}', { bold: true, size: 24 }), 3000, { align: 'right' })]),
    ],
    [6000, 3000],
  ),
  paragraph(run(''), { spacingAfter: 200 }),
  paragraph(run('{notices}')),
  paragraph(run('{notes}')),
  paragraph(run('How to pay', { bold: true })),
  paragraph(run('{paymentDetails}'), { spacingAfter: 300 }),
  paragraph(run('{legalFooter}', { size: 15, color: '666666' }), { align: 'center' }),
].join('');

const zip = new PizZip();
zip.file(
  '[Content_Types].xml',
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
);
zip.file(
  '_rels/.rels',
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
);
zip.file(
  'word/document.xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1100" w:bottom="1000" w:left="1100" w:header="500" w:footer="500" w:gutter="0"/></w:sectPr></w:body></w:document>`,
);
writeFileSync(new URL('../templates/sample-uk-vat-invoice.docx', import.meta.url), zip.generate({ type: 'nodebuffer' }));
