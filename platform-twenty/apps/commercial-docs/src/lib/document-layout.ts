import { TEMPLATE_DOCUMENT_TYPES, TEMPLATE_VAT_SCHEMES, type TemplateFormat } from 'src/constants/enums';
import { downloadFile, gql, nodes } from 'src/lib/api';
import { type PdfModel, renderPdf } from 'src/lib/pdf';
import {
  convertDocxToPdf,
  detectFileKind,
  fillDocx,
  fillPdfForm,
  formFieldTags,
  type RawTag,
  readDocx,
  readPdf,
  templateData,
} from 'src/lib/template-files';
import {
  casesCovered,
  classifyText,
  letterheadBands,
  missingTags,
  selectTemplate,
  sortTags,
  type TemplateCandidate,
  type TemplateContext,
} from 'src/lib/template-rules';

type TemplateRecord = TemplateCandidate & {
  file: { fileId: string; label: string; url: string }[] | null;
  headerHeightMm: number | null;
  footerHeightMm: number | null;
  checkedAt: string | null;
};

const TEMPLATE_FIELDS = `id name file { fileId label url } documentType vatScheme format status isActive priority companyId lineRows
  headerHeightMm footerHeightMm checkedAt createdAt`;

const updateTemplate = (id: string, data: Record<string, unknown>) =>
  gql(`mutation($id: UUID!, $data: DocumentTemplateUpdateInput!) { updateDocumentTemplate(id: $id, data: $data) { id } }`, { id, data });

const caseLabel = (documentType: string, vatScheme: string) =>
  `${TEMPLATE_DOCUMENT_TYPES[documentType as keyof typeof TEMPLATE_DOCUMENT_TYPES].label}, ${TEMPLATE_VAT_SCHEMES[vatScheme as keyof typeof TEMPLATE_VAT_SCHEMES].label}`;

// Reads an uploaded template, works out what it is for with fixed keyword rules (OCR for scans), checks it can show
// everything a UK document of that kind must show, and marks it Ready or Needs attention with the reasons.
export const checkTemplate = async (id: string) => {
  try {
    return await inspectTemplate(id);
  } catch (error) {
    await updateTemplate(id, {
      status: 'NEEDS_ATTENTION',
      checkReport: `Could not read the file: ${(error as Error).message}`,
      checkedAt: new Date().toISOString(),
    });
    return { status: 'NEEDS_ATTENTION' };
  }
};

const inspectTemplate = async (id: string) => {
  const data = await gql<{ documentTemplates: { edges: { node: TemplateRecord }[] } }>(
    `query($id: UUID!) { documentTemplates(filter: { id: { eq: $id } }) { edges { node { ${TEMPLATE_FIELDS} } } } }`,
    { id },
  );
  const template = nodes(data.documentTemplates)[0];
  if (!template) return null;
  const checkedAt = new Date().toISOString();
  const file = template.file?.[0];
  if (!file) {
    await updateTemplate(id, { status: 'NEEDS_ATTENTION', checkReport: 'Upload a Word (.docx) or PDF file.', checkedAt });
    return { status: 'NEEDS_ATTENTION' };
  }

  const bytes = await downloadFile(file.url);
  const kind = detectFileKind(bytes);
  if (!kind) {
    await updateTemplate(id, { status: 'NEEDS_ATTENTION', checkReport: `${file.label} is not a Word (.docx) or PDF file.`, checkedAt });
    return { status: 'NEEDS_ATTENTION' };
  }

  const issues: string[] = [];
  const notes: string[] = [];
  let format: TemplateFormat;
  let text: string;
  let readBy: string;
  let tags: RawTag[] = [];
  let lineRows: number | null = null;
  let bands: ReturnType<typeof letterheadBands> | null = null;

  if (kind === 'DOCX') {
    const read = readDocx(bytes);
    format = 'DOCX_MERGE';
    ({ text, tags } = read);
    readBy = 'Word document text';
    issues.push(...read.errors.map((error) => `Template error: ${error}`));
    if (!process.env.DOCUMENT_CONVERTER_URL) issues.push('No document converter is configured on the server, so Word templates cannot be turned into PDFs yet.');
  } else {
    const read = await readPdf(bytes);
    ({ text, readBy } = read);
    if (read.fieldNames.length > 0) {
      format = 'PDF_FORM';
      ({ tags, lineRows } = formFieldTags(read.fieldNames));
      if (lineRows === 0) issues.push('The form has no line fields (description_1, quantity_1, unitPrice_1, lineNet_1 and so on).');
    } else {
      format = 'PDF_LETTERHEAD';
      bands = letterheadBands(read.boxes, read.height);
      if (bands.middleContent > 0)
        issues.push('There is content in the middle of the page, so this looks like a finished document rather than a letterhead. Upload a letterhead with only a header and footer, a fillable PDF form, or a Word template.');
      if (Math.abs(read.width - 595.28) > 3 || Math.abs(read.height - 841.89) > 3) notes.push('The page is not A4; it is scaled to A4.');
      if (read.pages > 1) notes.push('Only the first page is used as the letterhead.');
    }
  }

  const classification = classifyText(text, tags.map((tag) => tag.name));
  const documentType = template.documentType === 'AUTO' ? classification.documentType : template.documentType;
  const vatScheme = template.vatScheme === 'AUTO' ? classification.vatScheme : template.vatScheme;
  if (template.documentType !== 'AUTO' && template.documentType !== classification.documentType && classification.documentType !== 'ANY')
    notes.push(`You set ${TEMPLATE_DOCUMENT_TYPES[template.documentType].label}; the file reads as ${TEMPLATE_DOCUMENT_TYPES[classification.documentType].label}. Your choice is kept.`);

  if (format !== 'PDF_LETTERHEAD') {
    const use = sortTags(tags);
    if (use.unknown.length > 0) issues.push(`Unknown tags (check the spelling): ${use.unknown.map((tag) => `{${tag}}`).join(', ')}`);
    for (const [caseType, caseScheme] of casesCovered(documentType, vatScheme)) {
      const missing = missingTags(use, caseType, caseScheme);
      if (missing.length > 0) issues.push(`For ${caseLabel(caseType, caseScheme)} it must show: ${missing.join(', ')}`);
    }
  }

  const status = issues.length > 0 ? 'NEEDS_ATTENTION' : 'READY';
  const headerHeightMm = template.headerHeightMm || bands?.headerHeightMm || null;
  const footerHeightMm = template.footerHeightMm || bands?.footerHeightMm || null;
  const report = [
    status === 'READY' ? 'Ready.' : 'Needs attention:',
    ...issues.map((issue) => `- ${issue}`),
    `Used for: ${caseLabel(documentType, vatScheme)}.`,
    ...classification.evidence,
    ...(bands ? [`Our layout prints from ${headerHeightMm} mm below the top to ${footerHeightMm} mm above the bottom.`] : []),
    ...(tags.length ? [`Tags found: ${tags.map((tag) => `{${tag.loop ? `${tag.loop}.` : ''}${tag.name}}`).join(' ')}`] : []),
    ...notes,
  ];
  await updateTemplate(id, {
    documentType,
    vatScheme,
    format,
    status,
    readBy,
    lineRows,
    headerHeightMm,
    footerHeightMm,
    checkReport: report.join('\n'),
    checkedAt,
  });
  return { status, documentType, vatScheme, format, issues };
};

export type LayoutContext = Omit<TemplateContext, 'converterAvailable' | 'lineCount'>;

// Picks the template for a document with fixed rules and renders it. A template that fails at render time falls back
// to the built-in layout, so issuing never stops because of a template; the document records which layout it used.
export const renderDocumentPdf = async (model: PdfModel, context: LayoutContext): Promise<{ bytes: Uint8Array; layoutUsed: string }> => {
  const data = await gql<{ documentTemplates: { edges: { node: TemplateRecord }[] } }>(
    `{ documentTemplates(first: 200) { edges { node { ${TEMPLATE_FIELDS} } } } }`,
  );
  const candidates = nodes(data.documentTemplates);
  const { template, reason } = selectTemplate(candidates, {
    ...context,
    lineCount: model.lines.length,
    converterAvailable: Boolean(process.env.DOCUMENT_CONVERTER_URL),
  });
  const chosen = candidates.find((candidate) => candidate.id === template?.id);
  const file = chosen?.file?.[0];
  if (!chosen || !file) return { bytes: await renderPdf(model), layoutUsed: reason };

  try {
    const bytes = await downloadFile(file.url);
    const pdf =
      chosen.format === 'DOCX_MERGE'
        ? await convertDocxToPdf(fillDocx(bytes, templateData(model)))
        : chosen.format === 'PDF_FORM'
          ? await fillPdfForm(bytes, templateData(model))
          : await renderPdf(model, { bytes, headerHeightMm: chosen.headerHeightMm ?? 15, footerHeightMm: chosen.footerHeightMm ?? 15 });
    return { bytes: pdf, layoutUsed: reason };
  } catch (error) {
    return {
      bytes: await renderPdf(model),
      layoutUsed: `Built-in UK layout: template ${chosen.name} could not be used (${(error as Error).message}).`,
    };
  }
};
