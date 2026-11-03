import { readFileSync } from 'node:fs';

import { PDFDocument, StandardFonts } from 'pdf-lib';
import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';

import { type BusinessProfile } from 'src/lib/compliance';
import { computeTotals } from 'src/lib/money';
import { buildInvoicePdfModel } from 'src/lib/templates';
import { fillDocx, fillPdfForm, formFieldTags, readDocx, readPdf, templateData } from 'src/lib/template-files';
import {
  classifyText,
  letterheadBands,
  missingTags,
  selectTemplate,
  sortTags,
  type TemplateCandidate,
} from 'src/lib/template-rules';

const address = { addressStreet1: '1 High Street', addressCity: 'Leeds', addressPostcode: 'LS1 1AA', addressCountry: 'United Kingdom' };
const profile = {
  id: 'p',
  legalName: 'Bright Electrical Ltd',
  legalStructure: 'LIMITED_COMPANY',
  companyNumber: '12345678',
  registeredIn: 'ENGLAND_AND_WALES',
  registeredOfficeAddress: '1 High Street, Leeds LS1 1AA',
  businessAddress: address,
  vatRegistered: true,
  vatNumber: 'GB123456789',
} as BusinessProfile;

const lines = [
  { description: 'Rewire kitchen', quantity: 1, unit: null, unitPricePence: 45000, vatRate: 'STANDARD_20' as const },
  { description: 'Smoke alarm', quantity: 3, unit: 'item', unitPricePence: 2500, vatRate: 'STANDARD_20' as const },
];
const model = buildInvoicePdfModel({
  profile,
  template: 'UK_VAT_INVOICE',
  kind: 'INVOICE',
  number: 'INV-0042',
  customer: { name: 'Acme Lettings', address, vatNumber: null, email: null },
  issueDate: '2026-11-03',
  supplyDate: '2026-11-03',
  dueDate: '2026-12-03',
  purchaseOrderNumber: 'PO-7',
  creditedInvoiceNumber: null,
  notes: null,
  lines,
  totals: computeTotals(lines, { rounding: 'NEAREST_PENNY', reverseCharge: false }),
});

describe('classifying a template by its words', () => {
  it('lets the first document word decide, ignoring merge tags', () => {
    expect(classifyText('CREDIT NOTE for invoice {creditedInvoiceNumber} VAT reg no').documentType).toBe('CREDIT_NOTE');
    expect(classifyText('Tax invoice ... Quote reference {quoteNumber}').documentType).toBe('INVOICE');
    expect(classifyText('Quotation valid for 30 days').documentType).toBe('QUOTE');
    expect(classifyText('{quoteNumber} Acme Plumbing, 1 High Street').documentType).toBe('ANY');
  });

  it('reads the VAT scheme from the wording or the VAT tags', () => {
    expect(classifyText('Invoice. Reverse charge: customer to account for VAT').vatScheme).toBe('REVERSE_CHARGE');
    expect(classifyText('Invoice. We are not VAT registered').vatScheme).toBe('NON_VAT');
    expect(classifyText('Invoice', ['vatTotal']).vatScheme).toBe('VAT');
    expect(classifyText('Acme Plumbing letterhead').vatScheme).toBe('ANY');
  });
});

describe('picking the template for a document', () => {
  const base: TemplateCandidate = {
    id: 'general',
    name: 'General',
    format: 'PDF_LETTERHEAD',
    documentType: 'ANY',
    vatScheme: 'ANY',
    status: 'READY',
    isActive: true,
    priority: 0,
    companyId: null,
    lineRows: null,
    createdAt: '2026-11-01T00:00:00Z',
  };
  const context = { documentType: 'INVOICE' as const, vatScheme: 'VAT' as const, companyId: 'acme', lineCount: 4, converterAvailable: true };

  it('prefers the client, then the exact type, then priority', () => {
    const candidates: TemplateCandidate[] = [
      base,
      { ...base, id: 'invoices', documentType: 'INVOICE' },
      { ...base, id: 'high', documentType: 'INVOICE', priority: 5 },
      { ...base, id: 'acme', companyId: 'acme' },
    ];
    expect(selectTemplate(candidates, context).template?.id).toBe('acme');
    expect(selectTemplate(candidates.slice(0, 3), context).template?.id).toBe('high');
    expect(selectTemplate(candidates.slice(0, 2), context).template?.id).toBe('invoices');
  });

  it('skips templates that cannot be used and falls back to the built-in layout', () => {
    const candidates: TemplateCandidate[] = [
      { ...base, id: 'off', isActive: false },
      { ...base, id: 'draft', status: 'NEEDS_ATTENTION' },
      { ...base, id: 'quote', documentType: 'QUOTE' },
      { ...base, id: 'other-client', companyId: 'globex' },
      { ...base, id: 'small-form', format: 'PDF_FORM', lineRows: 3 },
      { ...base, id: 'word', format: 'DOCX_MERGE' },
    ];
    const result = selectTemplate(candidates, { ...context, converterAvailable: false });
    expect(result.template).toBeNull();
    expect(result.reason).toMatch(/Built-in UK layout/);
  });
});

describe('the sample Word template', () => {
  const sample = readFileSync(new URL('../../templates/sample-uk-vat-invoice.docx', import.meta.url));

  it('reads as a VAT invoice with every tag a UK VAT invoice needs', () => {
    const read = readDocx(sample);
    expect(read.errors).toEqual([]);
    const use = sortTags(read.tags);
    const classification = classifyText(read.text, read.tags.map((tag) => tag.name));
    expect(classification).toMatchObject({ documentType: 'INVOICE', vatScheme: 'VAT' });
    expect(use.unknown).toEqual([]);
    expect(missingTags(use, 'INVOICE', 'VAT')).toEqual([]);
    expect(missingTags(use, 'CREDIT_NOTE', 'VAT')).toEqual(['{creditedInvoiceNumber}']);
  });

  it('fills in the document, one table row per line', () => {
    const filled = new PizZip(fillDocx(sample, templateData(model))).file('word/document.xml')?.asText() ?? '';
    for (const value of ['VAT INVOICE', 'INV-0042', 'Acme Lettings', 'Rewire kitchen', '3 item', '£525.00', 'GB 123 4567 89', 'company number 12345678'])
      expect(filled).toContain(value);
    expect(filled).not.toMatch(/\{[a-zA-Z#/]/);
  });

  it('reports typos and broken loops instead of failing later', () => {
    const zip = new PizZip(sample);
    const xml = zip.file('word/document.xml')?.asText() ?? '';
    zip.file('word/document.xml', xml.replace('{documentNumber}', '{documentNumbr}').replace('{/lines}', ''));
    const read = readDocx(zip.generate({ type: 'uint8array' }));
    expect(read.errors.join(' ')).toMatch(/lines/);
    expect(sortTags([{ name: 'documentNumbr', loop: null }, { name: 'price', loop: 'lines' }]).unknown).toEqual(['documentNumbr', 'lines.price']);
  });
});

const pdfWith = async (draw: (page: ReturnType<PDFDocument['addPage']>, document: PDFDocument) => Promise<void> | void) => {
  const document = await PDFDocument.create();
  const page = document.addPage([595.28, 841.89]);
  await draw(page, document);
  return document.save();
};

describe('PDF templates', () => {
  it('measures a letterhead and keeps our layout clear of it', async () => {
    const bytes = await pdfWith(async (page, document) => {
      const font = await document.embedFont(StandardFonts.HelveticaBold);
      page.drawText('Bright Electrical', { x: 50, y: 780, size: 26, font });
      page.drawText('1 High Street, Leeds LS1 1AA', { x: 50, y: 30, size: 9, font });
    });
    const read = await readPdf(bytes);
    expect(read.fieldNames).toEqual([]);
    expect(read.readBy).toBe('PDF text layer');
    const bands = letterheadBands(read.boxes, read.height);
    expect(bands.middleContent).toBe(0);
    expect(bands.headerHeightMm).toBeGreaterThan(20);
    expect(bands.headerHeightMm).toBeLessThan(40);
    expect(bands.footerHeightMm).toBeLessThan(25);
  });

  it('spots a finished document that is not a letterhead', async () => {
    const bytes = await pdfWith(async (page, document) => {
      const font = await document.embedFont(StandardFonts.Helvetica);
      page.drawText('Bright Electrical', { x: 50, y: 780, size: 26, font });
      page.drawText('Rewire kitchen  £450.00', { x: 50, y: 420, size: 12, font });
    });
    const read = await readPdf(bytes);
    expect(letterheadBands(read.boxes, read.height).middleContent).toBeGreaterThan(0);
  });

  it('reads and fills a fillable PDF form', async () => {
    const bytes = await pdfWith((page, document) => {
      const form = document.getForm();
      ['documentNumber', 'customerName', 'total', 'description_1', 'lineNet_1', 'description_2', 'lineNet_2', 'summaryLabels'].forEach((name, index) =>
        form.createTextField(name).addToPage(page, { x: 50, y: 700 - index * 40, width: 300, height: 30 }),
      );
    });
    const read = await readPdf(bytes);
    const { tags, lineRows } = formFieldTags(read.fieldNames);
    expect(lineRows).toBe(2);
    expect(sortTags(tags).lines).toContain('description');
    const filled = await readPdf(await fillPdfForm(bytes, templateData(model)));
    expect(filled.fieldNames).toEqual([]);
    expect(filled.text).toContain('INV-0042');
    expect(filled.text).toContain('Smoke alarm');
  });

  it('reads a scanned credit note with OCR', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const text = await pdfWith(async (page, document) => {
      const font = await document.embedFont(StandardFonts.HelveticaBold);
      page.drawText('CREDIT NOTE', { x: 50, y: 760, size: 30, font });
      page.drawText('VAT registration no. GB 123 4567 89', { x: 50, y: 720, size: 14, font });
    });
    const standardFontDataUrl = new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname;
    const source = await pdfjs.getDocument({ data: text, standardFontDataUrl }).promise;
    const sourcePage = await source.getPage(1);
    const viewport = sourcePage.getViewport({ scale: 2 });
    const { canvas, context } = (source.canvasFactory as { create(w: number, h: number): { canvas: { toBuffer(type: string): Buffer }; context: unknown } }).create(viewport.width, viewport.height);
    await sourcePage.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as CanvasRenderingContext2D, viewport }).promise;
    const scan = await pdfWith(async (page, document) => {
      page.drawImage(await document.embedPng(canvas.toBuffer('image/png')), { x: 0, y: 0, width: 595.28, height: 841.89 });
    });

    const read = await readPdf(scan);
    expect(read.readBy).toMatch(/OCR/);
    expect(classifyText(read.text)).toMatchObject({ documentType: 'CREDIT_NOTE', vatScheme: 'VAT' });
  }, 60_000);
});
