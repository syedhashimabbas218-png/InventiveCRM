// Business templates: upload Word and PDF templates, check the rule-based classification (OCR for a scan) and the UK
// checks, then issue documents and check which template the rules picked and what the PDF says.
// Runs from the app directory (needs pdfjs-dist): node e2e/inv5-templates.mjs <key file> <fixtures directory>
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { assert, client, summary, waitFor } from './inv-lib.mjs';
// No default: a forgotten variable must not send test traffic to a live server on the usual port.
const SERVER_URL = process.env.SERVER_URL;
if (!SERVER_URL) throw new Error('Set SERVER_URL to the throwaway test server, for example http://localhost:3001');

const [keyFile, fixtures] = process.argv.slice(2);
const { gql, key } = client(keyFile);
const require = createRequire(join(process.cwd(), 'package.json'));
const pdfjs = await import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
const run = Date.now().toString(36);

const ids = readFileSync('src/constants/ids.ts', 'utf8');
const TEMPLATE_FILE_FIELD = /documentTemplate: \{[\s\S]*?file: '([^']+)'/.exec(ids)[1];

const metadata = async (query, variables) => {
  const response = await fetch(`${SERVER_URL}/metadata`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ query, variables }) });
  const payload = await response.json();
  if (payload.errors) throw new Error(JSON.stringify(payload.errors));
  return payload.data;
};

const upload = async (path) => {
  const bytes = readFileSync(path);
  const filename = path.split('/').at(-1);
  const { createFileUpload } = await metadata(
    `mutation($filename: String!, $size: Float!, $field: String!) { createFileUpload(filename: $filename, size: $size, fileFolder: FilesField, fieldMetadataUniversalIdentifier: $field) { fileId uploadUrl contentType } }`,
    { filename, size: bytes.byteLength, field: TEMPLATE_FILE_FIELD },
  );
  const put = await fetch(createFileUpload.uploadUrl, { method: 'PUT', headers: { 'Content-Type': createFileUpload.contentType }, body: bytes });
  if (!put.ok) throw new Error(`upload ${put.status}`);
  const { completeFileUpload } = await metadata(`mutation($fileId: String!) { completeFileUpload(fileId: $fileId) { id } }`, { fileId: createFileUpload.fileId });
  return { fileId: completeFileUpload.id, label: filename };
};

const TEMPLATE = 'id name status documentType vatScheme format readBy lineRows headerHeightMm footerHeightMm checkReport';
const addTemplate = async (name, file, extra = {}) => {
  const { createDocumentTemplate } = await gql(`mutation($data: DocumentTemplateCreateInput!) { createDocumentTemplate(data: $data) { id } }`, {
    data: { name, file: [await upload(join(fixtures, file))], ...extra },
  });
  return waitFor(`check of ${name}`, async () => {
    const template = (await gql(`query($id: UUID!) { documentTemplates(filter: { id: { eq: $id } }) { edges { node { ${TEMPLATE} } } } }`, { id: createDocumentTemplate.id })).documentTemplates.edges[0].node;
    return template.status === 'CHECKING' ? null : template;
  }, 120000);
};
const setTemplate = (id, data) => gql(`mutation($id: UUID!, $data: DocumentTemplateUpdateInput!) { updateDocumentTemplate(id: $id, data: $data) { id } }`, { id, data });

const pdfText = async (url) => {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const document = await pdfjs.getDocument({ data: bytes, standardFontDataUrl: require.resolve('pdfjs-dist/package.json').replace('package.json', 'standard_fonts/') }).promise;
  let text = '';
  for (let page = 1; page <= document.numPages; page += 1) text += `${(await (await document.getPage(page)).getTextContent()).items.map((item) => item.str).join(' ')} `;
  return text;
};

const address = (street) => ({ addressStreet1: street, addressCity: 'Leeds', addressPostcode: 'LS1 5HD', addressCountry: 'United Kingdom' });
const company = async (name, street) => (await gql(`mutation($data: CompanyCreateInput!) { createCompany(data: $data) { id } }`, { data: { name: `${name} ${run}`, address: address(street) } })).createCompany.id;
const LINE = (description, pounds) => ({ description, quantity: 1, unitPrice: { amountMicros: pounds * 1_000_000, currencyCode: 'GBP' }, vatRate: 'STANDARD_20' });

const issue = async (data, lines) => {
  const { createInvoice } = await gql(`mutation($data: InvoiceCreateInput!) { createInvoice(data: $data) { id } }`, { data: { name: 'Draft', template: 'UK_VAT_INVOICE', ...data } });
  await gql(`mutation($data: [InvoiceLineCreateInput!]!) { createInvoiceLines(data: $data) { id } }`, { data: lines.map((line) => ({ ...line, invoiceId: createInvoice.id })) });
  const get = async () => (await gql(`query($id: UUID!) { invoices(filter: { id: { eq: $id } }) { edges { node { id invoiceNumber total { amountMicros } complianceIssues layoutUsed pdf { url } } } } }`, { id: createInvoice.id })).invoices.edges[0].node;
  await waitFor('totals', async () => Number((await get()).total?.amountMicros) > 0);
  await gql(`mutation($id: UUID!) { updateInvoice(id: $id, data: { status: ISSUED }) { id } }`, { id: createInvoice.id });
  const issued = await waitFor('issued', async () => { const invoice = await get(); return invoice.pdf?.length || invoice.complianceIssues ? invoice : null; }, 120000);
  if (!issued.invoiceNumber) throw new Error(issued.complianceIssues);
  return { ...issued, text: await pdfText(issued.pdf[0].url) };
};

const profile = (await gql(`{ businessProfiles(first: 1, orderBy: [{ createdAt: AscNullsFirst }]) { edges { node { id } } } }`)).businessProfiles.edges[0].node;
await gql(`mutation($id: UUID!) { updateBusinessProfile(id: $id, data: { sendOnIssue: false }) { id } }`, { id: profile.id });
const existing = (await gql(`{ documentTemplates(first: 200) { edges { node { id } } } }`)).documentTemplates.edges;
for (const { node } of existing) await setTemplate(node.id, { isActive: false });

const clientA = await company('Letterhead client', '9 Park Row');
const clientB = await company('General client', '12 Kirkgate');

// 1. Adding templates: what the rules read from each file.
const word = await addTemplate('Our VAT invoice (Word)', 'sample-uk-vat-invoice.docx', { priority: 10 });
assert('Word template: read as a VAT invoice with merge tags, ready', word.status === 'READY' && word.documentType === 'INVOICE' && word.vatScheme === 'VAT' && word.format === 'DOCX_MERGE', `${word.status} ${word.documentType} ${word.vatScheme}: ${word.checkReport.split('\n').slice(0, 4).join(' | ')}`);

const typo = await addTemplate('Word template with a typo', 'typo-invoice.docx');
assert('Word template with a typo needs attention and says why', typo.status === 'NEEDS_ATTENTION' && typo.checkReport.includes('{sellerVatNo}') && typo.checkReport.includes('{sellerVatNumber}'), typo.checkReport.split('\n').slice(0, 3).join(' | '));

const letterhead = await addTemplate('Letterhead for one client', 'letterhead.pdf', { companyId: clientA });
assert('PDF letterhead: measured header and footer, any document, ready', letterhead.status === 'READY' && letterhead.format === 'PDF_LETTERHEAD' && letterhead.documentType === 'ANY' && letterhead.headerHeightMm >= 25 && letterhead.headerHeightMm <= 40 && letterhead.footerHeightMm <= 20, `${letterhead.status} header ${letterhead.headerHeightMm} mm, footer ${letterhead.footerHeightMm} mm, ${letterhead.documentType}`);

const scan = await addTemplate('Scanned credit note letterhead', 'scanned-credit-note-letterhead.pdf');
assert('scanned PDF is read with OCR and classified as a VAT credit note', scan.status === 'READY' && /OCR/.test(scan.readBy) && scan.documentType === 'CREDIT_NOTE' && scan.vatScheme === 'VAT', `${scan.readBy}; ${scan.documentType} ${scan.vatScheme}`);

const form = await addTemplate('Fillable invoice form', 'invoice-form.pdf', { priority: 20 });
assert('fillable PDF form: fields read as tags, 3 line rows, ready', form.status === 'READY' && form.format === 'PDF_FORM' && form.lineRows === 3 && form.documentType === 'INVOICE', `${form.status} ${form.format} rows ${form.lineRows}: ${form.checkReport.split('\n')[0]}`);

// 2. Issuing: which template the rules pick.
const forA = await issue({ companyId: clientA }, [LINE('Boiler service', 95)]);
assert('a client with its own template gets it', forA.layoutUsed.startsWith('Letterhead for one client') && forA.text.includes('ACME PLUMBING') && forA.text.includes(forA.invoiceNumber), forA.layoutUsed);

const small = await issue({ companyId: clientB }, [LINE('Radiator valve', 40), LINE('Labour', 60)]);
assert('highest priority wins among general templates (the form)', small.layoutUsed.startsWith('Fillable invoice form') && small.text.includes(small.invoiceNumber) && small.text.includes('Radiator valve'), small.layoutUsed);

const large = await issue({ companyId: clientB }, ['Rewire', 'Consumer unit', 'Smoke alarms', 'Certificate'].map((line, index) => LINE(line, 100 + index)));
assert('a document with more lines than the form holds goes to the next template (Word, converted by LibreOffice)', large.layoutUsed.startsWith('Our VAT invoice (Word)') && large.text.includes(large.invoiceNumber) && large.text.includes('Certificate'), large.layoutUsed);

const credit = await issue({ companyId: clientB, kind: 'CREDIT_NOTE', creditedInvoiceId: small.id }, [LINE('Labour refund', 60)]);
assert('a credit note gets the credit note template, not the invoice ones', credit.layoutUsed.startsWith('Scanned credit note letterhead') && credit.text.includes(credit.invoiceNumber), credit.layoutUsed);

for (const template of [word, letterhead, scan, form]) await setTemplate(template.id, { isActive: false });
const builtIn = await issue({ companyId: clientB }, [LINE('Callout', 70)]);
assert('with no matching template the built-in UK layout is used', builtIn.layoutUsed.startsWith('Built-in UK layout') && builtIn.text.includes('VAT INVOICE'), builtIn.layoutUsed);

await gql(`mutation($id: UUID!) { updateBusinessProfile(id: $id, data: { sendOnIssue: true }) { id } }`, { id: profile.id });
summary();
