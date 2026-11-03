// Writes the files inv5-templates.mjs uploads. Run from the app directory (it needs the app's node_modules):
// cp ../../tests/commercial-docs/make-template-fixtures.mjs . && node make-template-fixtures.mjs <output directory>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import PizZip from 'pizzip';

const require = createRequire(join(process.cwd(), 'package.json'));
const pdfjs = await import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
const out = process.argv[2];
mkdirSync(out, { recursive: true });

const page = async (draw) => {
  const document = await PDFDocument.create();
  const added = document.addPage([595.28, 841.89]);
  await draw(added, document, await document.embedFont(StandardFonts.HelveticaBold), await document.embedFont(StandardFonts.Helvetica));
  return document.save();
};

writeFileSync(
  join(out, 'letterhead.pdf'),
  await page((added, _document, bold, regular) => {
    added.drawRectangle({ x: 0, y: 770, width: 595.28, height: 72, color: rgb(0.12, 0.29, 0.55) });
    added.drawText('ACME PLUMBING & HEATING', { x: 40, y: 798, size: 22, font: bold, color: rgb(1, 1, 1) });
    added.drawText('Gas Safe registered 123456', { x: 40, y: 780, size: 9, font: regular, color: rgb(1, 1, 1) });
    added.drawText('Unit 4, Mill Lane, Leeds LS2 7HJ  |  0113 496 0000  |  acmeplumbing.test', { x: 40, y: 24, size: 8, font: regular });
  }),
);

// A "scan": the credit-note letterhead rendered to an image and wrapped in a PDF with no text layer.
const creditNote = await page((added, _document, bold, regular) => {
  added.drawText('CREDIT NOTE', { x: 40, y: 780, size: 30, font: bold });
  added.drawText('Acme Plumbing & Heating  -  VAT registration no. GB 123 4567 89', { x: 40, y: 755, size: 11, font: regular });
  added.drawText('Unit 4, Mill Lane, Leeds LS2 7HJ', { x: 40, y: 24, size: 9, font: regular });
});
const source = await pdfjs.getDocument({ data: creditNote, standardFontDataUrl: require.resolve('pdfjs-dist/package.json').replace('package.json', 'standard_fonts/') }).promise;
const sourcePage = await source.getPage(1);
const viewport = sourcePage.getViewport({ scale: 2 });
const { canvas, context } = source.canvasFactory.create(viewport.width, viewport.height);
await sourcePage.render({ canvas, canvasContext: context, viewport }).promise;
writeFileSync(
  join(out, 'scanned-credit-note-letterhead.pdf'),
  await page(async (added, document) => added.drawImage(await document.embedPng(canvas.toBuffer('image/png')), { x: 0, y: 0, width: 595.28, height: 841.89 })),
);

writeFileSync(
  join(out, 'invoice-form.pdf'),
  await page((added, document, bold) => {
    added.drawText('INVOICE', { x: 40, y: 790, size: 24, font: bold });
    const form = document.getForm();
    const box = (name, x, y, width, height) => form.createTextField(name).addToPage(added, { x, y, width, height, borderWidth: 0 });
    box('sellerName', 330, 790, 225, 18);
    box('sellerAddress', 330, 720, 225, 66);
    box('sellerVatNumber', 330, 700, 225, 16);
    box('customerName', 40, 650, 250, 18);
    box('customerAddress', 40, 580, 250, 66);
    box('documentNumber', 400, 650, 155, 16);
    box('issueDate', 400, 630, 155, 16);
    box('supplyDate', 400, 610, 155, 16);
    for (let row = 1; row <= 3; row += 1)
      [['description', 40, 240], ['quantity', 285, 45], ['unitPrice', 335, 70], ['vatRate', 410, 45], ['lineNet', 460, 95]].forEach(([name, x, width]) =>
        box(`${name}_${row}`, x, 520 - row * 22, width, 18),
      );
    box('summaryLabels', 300, 360, 160, 64);
    box('summaryAmounts', 460, 360, 95, 64);
    box('total', 460, 335, 95, 20);
    box('legalFooter', 40, 40, 515, 30);
  }),
);

writeFileSync(join(out, 'sample-uk-vat-invoice.docx'), readFileSync('templates/sample-uk-vat-invoice.docx'));
const sample = new PizZip(readFileSync('templates/sample-uk-vat-invoice.docx'));
sample.file('word/document.xml', sample.file('word/document.xml').asText().replace('{sellerVatNumber}', '{sellerVatNo}'));
writeFileSync(join(out, 'typo-invoice.docx'), sample.generate({ type: 'nodebuffer' }));
console.log('fixtures written to', out);
