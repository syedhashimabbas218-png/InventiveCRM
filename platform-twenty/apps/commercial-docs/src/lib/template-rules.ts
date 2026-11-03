import { type TemplateDocumentType, type TemplateFormat, type TemplateVatScheme } from 'src/constants/enums';

// Merge tags a template may use. Values are the same ones the built-in layout prints.
export const TEMPLATE_TAGS = {
  documentTitle: 'VAT INVOICE, INVOICE, CREDIT NOTE or QUOTATION',
  documentNumber: 'Invoice, credit note or quote number',
  issueDate: 'Date of the document',
  supplyDate: 'Time of supply (tax point)',
  dueDate: 'Payment due date',
  validUntil: 'Quote valid until',
  purchaseOrderNumber: "Customer's order reference",
  quoteNumber: 'Quote the invoice came from',
  creditedInvoiceNumber: 'Invoice a credit note reduces',
  sellerName: 'Legal name of the business',
  sellerTradingName: 'Trading name',
  sellerAddress: 'Business address (several lines)',
  sellerVatNumber: 'VAT registration number',
  sellerEmail: 'Business email',
  sellerPhone: 'Business phone',
  sellerWebsite: 'Business website',
  customerName: 'Customer name',
  customerAddress: 'Customer address (several lines)',
  customerVatNumber: "Customer's VAT number (reverse charge)",
  subtotal: 'Total excluding VAT',
  vatTotal: 'Total VAT',
  totalLabel: 'Total due, Total credit or Total',
  total: 'Amount payable',
  notices: 'Statutory wording: reverse charge, no VAT charged, late payment',
  notes: 'Notes and quote terms',
  paymentDetails: 'How to pay',
  legalFooter: 'Company number, place of registration and registered office',
} as const;

export const LINE_TAGS = {
  description: 'Line description',
  quantity: 'Quantity and unit',
  unitPrice: 'Unit price excluding VAT',
  vatRate: 'VAT rate',
  lineNet: 'Line amount excluding VAT',
} as const;

export const SUMMARY_TAGS = { label: 'Summary row label, e.g. VAT 20% on £100.00', amount: 'Summary row amount' } as const;

export const LOOPS = { lines: LINE_TAGS, summaryRows: SUMMARY_TAGS } as const;

export type TemplateTag = keyof typeof TEMPLATE_TAGS;
export type ConcreteDocumentType = Exclude<TemplateDocumentType, 'AUTO' | 'ANY'>;
export type ConcreteVatScheme = Exclude<TemplateVatScheme, 'AUTO' | 'ANY'>;

// ---------- Classification of an uploaded file ----------

const DOCUMENT_WORDS: { type: ConcreteDocumentType; pattern: RegExp }[] = [
  { type: 'CREDIT_NOTE', pattern: /\bcredit\s*note\b/ },
  { type: 'QUOTE', pattern: /\b(quotation|quote|estimate)\b/ },
  { type: 'INVOICE', pattern: /\b(tax\s+invoice|vat\s+invoice|invoice)\b/ },
];

export type Classification = {
  documentType: Exclude<TemplateDocumentType, 'AUTO'>;
  vatScheme: Exclude<TemplateVatScheme, 'AUTO'>;
  evidence: string[];
};

const normalise = (text: string) =>
  text
    .replace(/\{[^{}]*\}/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ');

// The title comes first on a document, so the earliest document word decides ("Quote reference" lower down an
// invoice does not make it a quote). Tags are ignored so {quoteNumber} on an invoice does not count either.
export const classifyText = (rawText: string, tags: string[] = []): Classification => {
  const text = normalise(rawText);
  const evidence: string[] = [];

  const firstWord = DOCUMENT_WORDS.map(({ type, pattern }) => ({ type, match: pattern.exec(text) }))
    .filter((candidate): candidate is { type: ConcreteDocumentType; match: RegExpExecArray } => candidate.match !== null)
    .sort((first, second) => first.match.index - second.match.index)[0];
  const documentType = firstWord?.type ?? 'ANY';
  evidence.push(
    firstWord
      ? `Type: the first document word is "${firstWord.match[0]}" (character ${firstWord.match.index + 1}).`
      : 'Type: no document word (invoice, credit note, quote) found, so it can be used for any document.',
  );

  let vatScheme: Classification['vatScheme'] = 'ANY';
  const reverseCharge = /\breverse\s*charge\b/.exec(text);
  const notRegistered = /\b(not\s+(vat\s+)?registered\s+for\s+vat|not\s+vat\s+registered|no\s+vat\s+(has\s+been\s+|is\s+)?charged)\b/.exec(text);
  const vatTags = tags.filter((tag) => ['sellerVatNumber', 'vatTotal', 'vatRate', 'subtotal'].includes(tag));
  const vatWord = /\bvat\b/.exec(text);
  if (reverseCharge) {
    vatScheme = 'REVERSE_CHARGE';
    evidence.push(`VAT: mentions "${reverseCharge[0]}".`);
  } else if (notRegistered) {
    vatScheme = 'NON_VAT';
    evidence.push(`VAT: says "${notRegistered[0]}".`);
  } else if (vatTags.length > 0 || vatWord) {
    vatScheme = 'VAT';
    evidence.push(vatTags.length > 0 ? `VAT: uses ${vatTags.map((tag) => `{${tag}}`).join(', ')}.` : `VAT: mentions "${vatWord?.[0]}".`);
  } else {
    evidence.push('VAT: no VAT wording, so it can be used with or without VAT.');
  }
  return { documentType, vatScheme, evidence };
};

// ---------- UK requirements a template must be able to show ----------

const BASE_REQUIRED: TemplateTag[] = ['documentNumber', 'issueDate', 'sellerName', 'sellerAddress', 'customerName', 'total'];
const BASE_LINES = ['description', 'quantity', 'unitPrice', 'lineNet'];

export const requiredTags = (documentType: ConcreteDocumentType, vatScheme: ConcreteVatScheme) => {
  const fields = new Set<string>([...BASE_REQUIRED, 'legalFooter']);
  const lines = new Set<string>(BASE_LINES);
  const summary = new Set<string>();
  if (documentType === 'QUOTE') {
    fields.add('validUntil');
  } else if (vatScheme !== 'NON_VAT') {
    // HMRC full VAT invoice: tax point, seller VAT number, customer address, rate per line, VAT per rate.
    ['supplyDate', 'sellerVatNumber', 'customerAddress'].forEach((tag) => fields.add(tag));
    lines.add('vatRate');
    summary.add('label').add('amount');
  }
  if (vatScheme === 'REVERSE_CHARGE') ['customerVatNumber', 'notices'].forEach((tag) => fields.add(tag));
  if (vatScheme === 'NON_VAT' && documentType !== 'QUOTE') fields.add('notices');
  if (documentType === 'CREDIT_NOTE') fields.add('creditedInvoiceNumber');
  return { fields: [...fields], lines: [...lines], summaryRows: [...summary] };
};

export type TagUse = { fields: string[]; lines: string[]; summaryRows: string[]; unknown: string[] };

// Turns raw tags into fields and loop tags; anything unrecognised (usually a typo) is reported.
export const sortTags = (tags: { name: string; loop: string | null }[]): TagUse => {
  const use: TagUse = { fields: [], lines: [], summaryRows: [], unknown: [] };
  for (const { name, loop } of tags) {
    if (loop === 'lines' && name in LINE_TAGS) use.lines.push(name);
    else if (loop === 'summaryRows' && name in SUMMARY_TAGS) use.summaryRows.push(name);
    else if (loop === null && name in TEMPLATE_TAGS) use.fields.push(name);
    else if (loop === null && name in LOOPS) continue;
    else use.unknown.push(loop ? `${loop}.${name}` : name);
  }
  return use;
};

export const missingTags = (use: TagUse, documentType: ConcreteDocumentType, vatScheme: ConcreteVatScheme) => {
  const required = requiredTags(documentType, vatScheme);
  return [
    ...required.fields.filter((tag) => !use.fields.includes(tag)).map((tag) => `{${tag}}`),
    ...required.lines.filter((tag) => !use.lines.includes(tag)).map((tag) => `{${tag}} inside {#lines}...{/lines}`),
    ...required.summaryRows.filter((tag) => !use.summaryRows.includes(tag)).map((tag) => `{${tag}} inside {#summaryRows}...{/summaryRows}`),
  ];
};

// A template marked "any" must meet the strictest case it can be picked for.
export const casesCovered = (
  documentType: Exclude<TemplateDocumentType, 'AUTO'>,
  vatScheme: Exclude<TemplateVatScheme, 'AUTO'>,
): [ConcreteDocumentType, ConcreteVatScheme][] => {
  const types: ConcreteDocumentType[] = documentType === 'ANY' ? ['INVOICE', 'CREDIT_NOTE', 'QUOTE'] : [documentType];
  const schemes: ConcreteVatScheme[] = vatScheme === 'ANY' ? ['VAT', 'NON_VAT', 'REVERSE_CHARGE'] : [vatScheme];
  return types.flatMap((type) =>
    schemes.filter((scheme) => !(type === 'QUOTE' && scheme === 'REVERSE_CHARGE')).map((scheme): [ConcreteDocumentType, ConcreteVatScheme] => [type, scheme]),
  );
};

// ---------- Letterhead: where our layout may print ----------

export type Box = { top: number; bottom: number };

// Boxes are measured from the top of the page in points. Content in the top 40% is the header, in the bottom 30%
// the footer; anything in between means the PDF is a finished document rather than a letterhead.
export const letterheadBands = (boxes: Box[], pageHeight: number) => {
  const pointsToMm = (points: number) => Math.ceil((points / 72) * 25.4);
  const headerLimit = pageHeight * 0.4;
  const footerLimit = pageHeight * 0.7;
  const header = boxes.filter((box) => box.bottom <= headerLimit);
  const footer = boxes.filter((box) => box.top >= footerLimit);
  const middle = boxes.filter((box) => !header.includes(box) && !footer.includes(box));
  const headerBottom = Math.max(0, ...header.map((box) => box.bottom));
  const footerTop = Math.min(pageHeight, ...footer.map((box) => box.top));
  return {
    headerHeightMm: header.length ? pointsToMm(headerBottom) + 6 : 15,
    footerHeightMm: footer.length ? pointsToMm(pageHeight - footerTop) + 4 : 15,
    middleContent: middle.length,
  };
};

// ---------- Picking the template for a document ----------

export type TemplateCandidate = {
  id: string;
  name: string;
  format: TemplateFormat;
  documentType: TemplateDocumentType;
  vatScheme: TemplateVatScheme;
  status: string;
  isActive: boolean;
  priority: number;
  companyId: string | null;
  lineRows: number | null;
  createdAt: string;
};

export type TemplateContext = {
  documentType: ConcreteDocumentType;
  vatScheme: ConcreteVatScheme;
  companyId: string | null;
  lineCount: number;
  converterAvailable: boolean;
};

const usable = (candidate: TemplateCandidate, context: TemplateContext): string | null => {
  if (!candidate.isActive) return 'switched off';
  if (candidate.status !== 'READY') return 'not ready';
  if (candidate.documentType !== 'ANY' && candidate.documentType !== context.documentType) return 'other document type';
  if (candidate.vatScheme !== 'ANY' && candidate.vatScheme !== context.vatScheme) return 'other VAT scheme';
  if (candidate.companyId && candidate.companyId !== context.companyId) return 'for another client';
  if (candidate.format === 'PDF_FORM' && (candidate.lineRows ?? 0) < context.lineCount)
    return `form has ${candidate.lineRows ?? 0} line rows, document has ${context.lineCount} lines`;
  if (candidate.format === 'DOCX_MERGE' && !context.converterAvailable) return 'no document converter configured';
  return null;
};

// Most specific wins: a client's own template, then an exact document type, then an exact VAT scheme,
// then the higher priority, then the newest.
export const selectTemplate = (candidates: TemplateCandidate[], context: TemplateContext) => {
  const eligible = candidates.filter((candidate) => usable(candidate, context) === null);
  const score = (candidate: TemplateCandidate) => [
    candidate.companyId ? 1 : 0,
    candidate.documentType === 'ANY' ? 0 : 1,
    candidate.vatScheme === 'ANY' ? 0 : 1,
    candidate.priority,
    Date.parse(candidate.createdAt) || 0,
  ];
  const [winner] = [...eligible].sort((first, second) => {
    const [a, b] = [score(first), score(second)];
    for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return b[index] - a[index];
    return 0;
  });
  if (!winner) return { template: null, reason: 'Built-in UK layout (no matching ready template).' };
  const matched = [
    winner.companyId ? 'this client' : null,
    winner.documentType === 'ANY' ? null : 'document type',
    winner.vatScheme === 'ANY' ? null : 'VAT scheme',
  ].filter(Boolean);
  return {
    template: winner,
    reason: `${winner.name} (matched ${matched.length ? matched.join(', ') : 'any document'}; priority ${winner.priority}; ${eligible.length} of ${candidates.length} templates eligible).`,
  };
};
