import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'pdf-lib';

import { formatGbp } from 'src/lib/money';

export type PdfLine = {
  description: string;
  quantity: number;
  unit: string | null;
  unitPricePence: number;
  vatLabel: string | null;
  netPence: number;
};

export type PdfModel = {
  title: string;
  number: string;
  sellerLines: string[];
  customerHeading: string;
  customerLines: string[];
  metaRows: [string, string][];
  showVatColumn: boolean;
  lines: PdfLine[];
  summaryRows: [string, string][];
  totalRow: [string, string];
  notices: string[];
  notes: string | null;
  paymentLines: string[];
  footerLines: string[];
};

const PAGE = { width: 595.28, height: 841.89, margin: 48 };
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.42, 0.46);
const RULE = rgb(0.85, 0.85, 0.87);

// Standard PDF fonts use WinAnsi encoding: map characters it cannot encode to safe equivalents.
const sanitise = (text: string) =>
  text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF£€\n]/g, '');

const wrap = (text: string, font: PDFFont, size: number, width: number): string[] => {
  const result: string[] = [];
  for (const paragraph of sanitise(text).split('\n')) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) current = candidate;
      else {
        if (current) result.push(current);
        current = word;
      }
    }
    result.push(current);
  }
  return result;
};

export const renderPdf = async (model: PdfModel): Promise<Uint8Array> => {
  const document = await PDFDocument.create();
  document.setTitle(`${model.title} ${model.number}`);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = document.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - PAGE.margin;
  const contentWidth = PAGE.width - PAGE.margin * 2;

  const newPageIfNeeded = (height: number) => {
    if (y - height < PAGE.margin + 40) {
      page = document.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - PAGE.margin;
    }
  };

  const text = (value: string, x: number, options: { font?: PDFFont; size?: number; color?: typeof INK; alignRight?: number } = {}) => {
    const font = options.font ?? regular;
    const size = options.size ?? 9.5;
    const safe = sanitise(value);
    const drawX = options.alignRight !== undefined ? options.alignRight - font.widthOfTextAtSize(safe, size) : x;
    page.drawText(safe, { x: drawX, y, size, font, color: options.color ?? INK });
  };

  // Header: title and number on the left, seller details on the right.
  text(model.title, PAGE.margin, { font: bold, size: 20 });
  y -= 18;
  text(model.number, PAGE.margin, { size: 11, color: MUTED });
  let sellerY = PAGE.height - PAGE.margin;
  for (const [index, line] of model.sellerLines.entries()) {
    page.drawText(sanitise(line), {
      x: PAGE.width - PAGE.margin - (index === 0 ? bold : regular).widthOfTextAtSize(sanitise(line), index === 0 ? 11 : 9),
      y: sellerY,
      size: index === 0 ? 11 : 9,
      font: index === 0 ? bold : regular,
      color: index === 0 ? INK : MUTED,
    });
    sellerY -= index === 0 ? 14 : 11.5;
  }
  y = Math.min(y, sellerY) - 24;

  // Customer block and document details side by side.
  const blockTop = y;
  text(model.customerHeading, PAGE.margin, { font: bold, size: 9, color: MUTED });
  y -= 14;
  for (const line of model.customerLines) {
    text(line, PAGE.margin);
    y -= 12;
  }
  const customerBottom = y;
  y = blockTop;
  const metaLabelX = PAGE.width / 2 + 20;
  for (const [label, value] of model.metaRows) {
    text(label, metaLabelX, { font: bold, size: 9, color: MUTED });
    text(value, 0, { alignRight: PAGE.width - PAGE.margin });
    y -= 13;
  }
  y = Math.min(customerBottom, y) - 18;

  // Line items table.
  const columns = model.showVatColumn
    ? { description: PAGE.margin, quantity: 330, unitPrice: 400, vat: 470, amount: PAGE.width - PAGE.margin }
    : { description: PAGE.margin, quantity: 360, unitPrice: 450, vat: 0, amount: PAGE.width - PAGE.margin };
  const descriptionWidth = columns.quantity - columns.description - 40;
  const drawTableHeader = () => {
    page.drawRectangle({ x: PAGE.margin, y: y - 5, width: contentWidth, height: 18, color: rgb(0.95, 0.95, 0.96) });
    text('Description', columns.description + 4, { font: bold, size: 8.5 });
    text('Qty', 0, { font: bold, size: 8.5, alignRight: columns.quantity });
    text('Unit price', 0, { font: bold, size: 8.5, alignRight: columns.unitPrice });
    if (model.showVatColumn) text('VAT rate', 0, { font: bold, size: 8.5, alignRight: columns.vat });
    text('Amount', 0, { font: bold, size: 8.5, alignRight: columns.amount - 4 });
    y -= 20;
  };
  drawTableHeader();
  for (const line of model.lines) {
    const descriptionLines = wrap(line.description, regular, 9.5, descriptionWidth);
    newPageIfNeeded(descriptionLines.length * 12 + 8);
    const rowTop = y;
    for (const descriptionLine of descriptionLines) {
      text(descriptionLine, columns.description + 4);
      y -= 12;
    }
    const rowBottom = y;
    y = rowTop;
    const quantity = Number.isInteger(line.quantity) ? String(line.quantity) : line.quantity.toFixed(2);
    text(line.unit ? `${quantity} ${line.unit}` : quantity, 0, { alignRight: columns.quantity });
    text(formatGbp(line.unitPricePence), 0, { alignRight: columns.unitPrice });
    if (model.showVatColumn && line.vatLabel) text(line.vatLabel, 0, { alignRight: columns.vat, size: 8.5 });
    text(formatGbp(line.netPence), 0, { alignRight: columns.amount - 4 });
    y = rowBottom - 4;
    page.drawLine({ start: { x: PAGE.margin, y: y + 2 }, end: { x: PAGE.width - PAGE.margin, y: y + 2 }, thickness: 0.5, color: RULE });
    y -= 6;
  }

  // Totals.
  newPageIfNeeded(model.summaryRows.length * 14 + 40);
  y -= 6;
  const totalsLabelX = PAGE.width / 2 - 20;
  for (const [label, value] of model.summaryRows) {
    text(label, totalsLabelX, { size: 9, color: MUTED });
    text(value, 0, { alignRight: PAGE.width - PAGE.margin - 4 });
    y -= 14;
  }
  page.drawLine({ start: { x: totalsLabelX, y: y + 8 }, end: { x: PAGE.width - PAGE.margin, y: y + 8 }, thickness: 0.8, color: INK });
  y -= 6;
  text(model.totalRow[0], totalsLabelX, { font: bold, size: 11 });
  text(model.totalRow[1], 0, { font: bold, size: 11, alignRight: PAGE.width - PAGE.margin - 4 });
  y -= 26;

  const paragraph = (heading: string | null, lines: string[], options: { size?: number; color?: typeof INK } = {}) => {
    if (lines.length === 0) return;
    const size = options.size ?? 9;
    const wrapped = lines.flatMap((line) => wrap(line, regular, size, contentWidth));
    newPageIfNeeded(wrapped.length * (size + 3) + (heading ? 16 : 0));
    if (heading) {
      text(heading, PAGE.margin, { font: bold, size: 9.5 });
      y -= 14;
    }
    for (const line of wrapped) {
      text(line, PAGE.margin, { size, color: options.color });
      y -= size + 3;
    }
    y -= 10;
  };

  for (const notice of model.notices) paragraph(null, [notice], { size: 9.5 });
  if (model.notes) paragraph('Notes', [model.notes]);
  paragraph('How to pay', model.paymentLines);

  // Statutory footer on every page.
  const pages = document.getPages();
  pages.forEach((footerPage, index) => {
    let footerY = PAGE.margin - 10 + (model.footerLines.length - 1) * 10;
    for (const line of model.footerLines) {
      const safe = sanitise(line);
      const size = 7.5;
      footerPage.drawText(safe, {
        x: (PAGE.width - regular.widthOfTextAtSize(safe, size)) / 2,
        y: footerY,
        size,
        font: regular,
        color: MUTED,
      });
      footerY -= 10;
    }
    const pageLabel = `Page ${index + 1} of ${pages.length}`;
    footerPage.drawText(pageLabel, {
      x: PAGE.width - PAGE.margin - regular.widthOfTextAtSize(pageLabel, 7.5),
      y: PAGE.margin - 26,
      size: 7.5,
      font: regular,
      color: MUTED,
    });
  });

  return document.save();
};
