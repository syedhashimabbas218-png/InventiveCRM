import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';

import Docxtemplater from 'docxtemplater';
import InspectModule from 'docxtemplater/js/inspect-module.js';
import { PDFDocument, PDFTextField, StandardFonts } from 'pdf-lib';
import PizZip from 'pizzip';

import { formatGbp } from 'src/lib/money';
import { formatQuantity, type PdfModel, sanitise } from 'src/lib/pdf';
import { type Box, LINE_TAGS, LOOPS } from 'src/lib/template-rules';

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type PixelReader = { getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray } };
type TesseractApi = {
  Init(dataPath: string | null, language: string): number;
  SetVariable(name: string, value: string): boolean;
  SetImageFile(exifOrientation: number, angle: number): number;
  Recognize(monitor: null): number;
  GetUTF8Text(): string;
  End(): void;
};
type TesseractCore = { FS: { writeFile(path: string, data: Uint8Array): void }; TessBaseAPI: new () => TesseractApi };

// pdf.js and Tesseract ship WebAssembly and a native canvas that cannot be bundled into a function file,
// so they load from the app's installed node_modules when a template is checked.
const runtimeImport = <TModule>(specifier: string): Promise<TModule> => import(specifier);
const resolvePackageFile = (specifier: string) => createRequire(import.meta.url).resolve(specifier);

export type RawTag = { name: string; loop: string | null };

export const templateData = (model: PdfModel) => ({
  ...model.values,
  totalLabel: model.totalRow[0],
  total: model.totalRow[1],
  notices: model.notices.join('\n'),
  notes: model.notes ?? '',
  paymentDetails: model.paymentLines.join('\n'),
  legalFooter: model.footerLines.join('\n'),
  lines: model.lines.map((line) => ({
    description: line.description,
    quantity: formatQuantity(line.quantity, line.unit),
    unitPrice: formatGbp(line.unitPricePence),
    vatRate: line.vatLabel ?? '',
    lineNet: formatGbp(line.netPence),
  })),
  summaryRows: model.summaryRows.map(([label, amount]) => ({ label, amount })),
});

export const detectFileKind = (bytes: Uint8Array): 'DOCX' | 'PDF' | null => {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'PDF';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      return new PizZip(bytes).file('word/document.xml') ? 'DOCX' : null;
    } catch {
      return null;
    }
  }
  return null;
};

// ---------- Size limits ----------

// Templates come from clients. These limits keep one crafted file (a zip bomb or a page the size of a wall) from
// exhausting the memory every workspace shares.
const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;
const MAX_DOCX_UNPACKED_BYTES = 50 * 1024 * 1024;
const MAX_PAGE_POINTS = 1700;
const MAX_RENDER_PIXELS = 10_000_000;

export const templateSizeProblem = (bytes: Uint8Array, kind: 'DOCX' | 'PDF') => {
  if (bytes.length > MAX_TEMPLATE_BYTES) return 'The file is larger than 10 MB.';
  if (kind === 'DOCX') {
    const unpacked = Object.values(new PizZip(bytes).files).reduce(
      (total, entry) => total + ((entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0),
      0,
    );
    if (unpacked > MAX_DOCX_UNPACKED_BYTES) return 'The Word file unpacks to more than 50 MB.';
  }
  return null;
};

// Remote images, embedded objects, sub-documents and INCLUDE fields would make the converter fetch URLs or local
// files. Hyperlinks stay.
const FETCHING_RELATIONSHIP = /<Relationship\b[^>]*Type="[^"]*\/(image|oleObject|attachedTemplate|subDocument|frame|package|audio|video)"[^>]*TargetMode="External"[^>]*\/>|<Relationship\b[^>]*TargetMode="External"[^>]*Type="[^"]*\/(image|oleObject|attachedTemplate|subDocument|frame|package|audio|video)"[^>]*\/>/g;
const INCLUDE_FIELD = /\b(INCLUDEPICTURE|INCLUDETEXT|INCLUDE|LINK|DDEAUTO|DDE|IMPORT)\b/g;

export const stripExternalReferences = (docx: Uint8Array) => {
  const zip = new PizZip(docx);
  for (const name of Object.keys(zip.files)) {
    if (name.endsWith('.rels')) zip.file(name, (zip.file(name)?.asText() ?? '').replace(FETCHING_RELATIONSHIP, ''));
    else if (/^word\/[^/]+\.xml$/.test(name)) {
      const xml = zip.file(name)?.asText() ?? '';
      if (INCLUDE_FIELD.test(xml)) zip.file(name, xml.replace(/<w:instrText([^>]*)>[^<]*\b(INCLUDEPICTURE|INCLUDETEXT|INCLUDE|LINK|DDEAUTO|DDE|IMPORT)\b[^<]*<\/w:instrText>/g, '<w:instrText$1></w:instrText>').replace(/w:instr="[^"]*\b(INCLUDEPICTURE|INCLUDETEXT|INCLUDE|LINK|DDEAUTO|DDE|IMPORT)\b[^"]*"/g, 'w:instr=""'));
      INCLUDE_FIELD.lastIndex = 0;
    }
  }
  return zip.generate({ type: 'uint8array' }) as Uint8Array;
};

// ---------- DOCX ----------

const newDocx = (bytes: Uint8Array, modules: InspectModule[] = []) =>
  new Docxtemplater(new PizZip(bytes), { paragraphLoop: true, linebreaks: true, modules, nullGetter: () => '', errorLogging: false });

const templateErrors = (error: unknown): string[] => {
  const nested = (error as { properties?: { errors?: { properties?: { explanation?: string } }[] } }).properties?.errors;
  if (nested?.length) return nested.map((item) => item.properties?.explanation ?? 'Template syntax error');
  return [(error as Error).message];
};

// Only {#lines} and {#summaryRows} are loops; any other {#tag}...{/tag} is a condition whose inner tags are top-level.
const flattenTags = (tree: Record<string, unknown>, loop: string | null = null): RawTag[] =>
  Object.entries(tree).flatMap(([name, children]) => {
    const nested = children && typeof children === 'object' && Object.keys(children as object).length > 0;
    const own: RawTag = { name, loop };
    if (!nested) return [own];
    return [own, ...flattenTags(children as Record<string, unknown>, loop ?? (name in LOOPS ? name : null))];
  });

export const readDocx = (bytes: Uint8Array) => {
  const inspect = new InspectModule();
  try {
    const document = newDocx(bytes, [inspect]);
    return { text: document.getFullText(), tags: flattenTags(inspect.getAllTags()), errors: [] as string[] };
  } catch (error) {
    return { text: '', tags: [] as RawTag[], errors: templateErrors(error) };
  }
};

export const fillDocx = (bytes: Uint8Array, data: ReturnType<typeof templateData>) => {
  const document = newDocx(bytes);
  document.render(data);
  return document.getZip().generate({ type: 'uint8array' }) as Uint8Array;
};

export const convertDocxToPdf = async (docx: Uint8Array) => {
  const converter = process.env.DOCUMENT_CONVERTER_URL;
  if (!converter) throw new Error('No document converter configured (DOCUMENT_CONVERTER_URL).');
  const form = new FormData();
  const safe = stripExternalReferences(docx);
  form.append('files', new Blob([safe.slice().buffer as ArrayBuffer]), 'document.docx');
  const response = await fetch(`${converter.replace(/\/$/, '')}/forms/libreoffice/convert`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60_000),
  }).catch((error: Error) => {
    throw new Error(`the document converter at ${converter} is not reachable (${error.message})`);
  });
  if (!response.ok) throw new Error(`Document converter answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return new Uint8Array(await response.arrayBuffer());
};

// ---------- PDF ----------

const FORM_LINE_FIELD = new RegExp(`^(${Object.keys(LINE_TAGS).join('|')})_(\\d+)$`);

export const formFieldTags = (fieldNames: string[]) => {
  let lineRows = 0;
  const tags: RawTag[] = fieldNames.map((name) => {
    const line = FORM_LINE_FIELD.exec(name);
    if (line) {
      lineRows = Math.max(lineRows, Number(line[2]));
      return { name: line[1], loop: 'lines' };
    }
    if (name === 'summaryLabels') return { name: 'label', loop: 'summaryRows' };
    if (name === 'summaryAmounts') return { name: 'amount', loop: 'summaryRows' };
    return { name, loop: null };
  });
  return { tags, lineRows };
};

const loadPdfJs = async (bytes: Uint8Array) => {
  const pdfjs = await runtimeImport<PdfJs>('pdfjs-dist/legacy/build/pdf.mjs');
  const standardFontDataUrl = resolvePackageFile('pdfjs-dist/package.json').replace('package.json', 'standard_fonts/');
  return pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl });
};

type PdfJsDocument = Awaited<Awaited<ReturnType<typeof loadPdfJs>>['promise']>;
type CanvasFactory = { create(width: number, height: number): { canvas: unknown; context: unknown } };

const renderPage = async (pdf: PdfJsDocument, scale: number) => {
  const page = await pdf.getPage(1);
  const natural = page.getViewport({ scale: 1 });
  if (natural.width > MAX_PAGE_POINTS || natural.height > MAX_PAGE_POINTS) throw new Error('The PDF page is larger than A3.');
  const viewport = page.getViewport({ scale: Math.min(scale, Math.sqrt(MAX_RENDER_PIXELS / (natural.width * natural.height))) });
  const { canvas, context } = (pdf.canvasFactory as CanvasFactory).create(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvas: canvas as HTMLCanvasElement, canvasContext: context as CanvasRenderingContext2D, viewport }).promise;
  return { canvas: canvas as { toBuffer(type: string): Buffer }, context: context as PixelReader, width: Math.ceil(viewport.width), height: Math.ceil(viewport.height) };
};

// Rows of the rendered page that contain ink, grouped into bands. Works the same for text, logos, vector art and scans.
const inkBands = (context: PixelReader, width: number, height: number): Box[] => {
  const pixels = context.getImageData(0, 0, width, height).data;
  const bands: Box[] = [];
  let start = -1;
  let lastInk = -10;
  for (let row = 0; row < height; row += 1) {
    let ink = false;
    for (let column = 0; column < width && !ink; column += 2) {
      const offset = (row * width + column) * 4;
      ink = pixels[offset + 3] > 0 && pixels[offset] + pixels[offset + 1] + pixels[offset + 2] < 600;
    }
    if (ink) {
      if (start < 0 || row - lastInk > 6) {
        if (start >= 0) bands.push({ top: start, bottom: lastInk + 1 });
        start = row;
      }
      lastInk = row;
    }
  }
  if (start >= 0) bands.push({ top: start, bottom: lastInk + 1 });
  return bands;
};

// Tesseract's WebAssembly engine runs in memory on this thread: the function sandbox allows no worker threads and
// no writes outside its own folder, which rules out the tesseract.js worker wrapper.
const ocrPage = async (pdf: PdfJsDocument) => {
  const { default: createCore } = await runtimeImport<{ default: () => Promise<TesseractCore> }>('tesseract.js-core/tesseract-core-simd-lstm.js');
  const core = await createCore();
  core.FS.writeFile('./eng.traineddata', gunzipSync(readFileSync(resolvePackageFile('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'))));
  const api = new core.TessBaseAPI();
  if (api.Init(null, 'eng') !== 0) throw new Error('OCR engine could not start');
  try {
    api.SetVariable('tessedit_pageseg_mode', '3');
    const { canvas } = await renderPage(pdf, 2);
    core.FS.writeFile('/input', canvas.toBuffer('image/png'));
    if (api.SetImageFile(1, 0) === 1) throw new Error('OCR could not read the rendered page');
    api.Recognize(null);
    return api.GetUTF8Text();
  } finally {
    api.End();
  }
};

export const readPdf = async (bytes: Uint8Array) => {
  const document = await PDFDocument.load(bytes);
  const fieldNames = document.getForm().getFields().map((field) => field.getName());
  const { width, height } = document.getPage(0).getSize();
  const loadingTask = await loadPdfJs(bytes);
  const pdf = await loadingTask.promise;
  try {
    let text = '';
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 3); pageNumber += 1) {
      const content = await (await pdf.getPage(pageNumber)).getTextContent();
      text += `${content.items.map((item) => ('str' in item ? item.str : '')).join(' ')}\n`;
    }
    let readBy = 'PDF text layer';
    if (text.replace(/\s/g, '').length < 20) {
      text = await ocrPage(pdf);
      readBy = 'OCR (Tesseract): the PDF has no text layer';
    }
    const page = await renderPage(pdf, 1);
    const boxes = inkBands(page.context, page.width, page.height).map((box) => ({
      top: (box.top / page.height) * height,
      bottom: (box.bottom / page.height) * height,
    }));
    return { fieldNames, text, readBy, boxes, width, height, pages: document.getPageCount() };
  } finally {
    await loadingTask.destroy();
  }
};

export const fillPdfForm = async (bytes: Uint8Array, data: ReturnType<typeof templateData>) => {
  const document = await PDFDocument.load(bytes);
  const form = document.getForm();
  const values: Record<string, string> = {
    summaryLabels: data.summaryRows.map((row) => row.label).join('\n'),
    summaryAmounts: data.summaryRows.map((row) => row.amount).join('\n'),
  };
  for (const [name, value] of Object.entries(data)) if (typeof value === 'string') values[name] = value;
  data.lines.forEach((line, index) => {
    for (const [name, value] of Object.entries(line)) values[`${name}_${index + 1}`] = value;
  });
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const field of form.getFields().filter((candidate): candidate is PDFTextField => candidate instanceof PDFTextField)) {
    const value = values[field.getName()];
    if (value === undefined) continue;
    const text = sanitise(value);
    const lines = text.split('\n');
    const { width, height } = field.acroField.getWidgets()[0].getRectangle();
    const widest = Math.max(1, ...lines.map((line) => font.widthOfTextAtSize(line, 1)));
    // Shrink to fit the box the form designer drew, never above 10pt.
    const size = Math.max(4, Math.min(10, (width - 4) / widest, (height - 2) / (lines.length * 1.2)));
    if (lines.length > 1) field.enableMultiline();
    field.setText(text);
    field.setFontSize(size);
  }
  form.updateFieldAppearances(font);
  form.flatten();
  return document.save();
};
