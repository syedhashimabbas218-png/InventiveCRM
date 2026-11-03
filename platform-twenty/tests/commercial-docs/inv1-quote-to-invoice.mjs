import { writeFileSync } from 'node:fs';
import { assert, client, pounds, summary, waitFor } from './inv-lib.mjs';
const { gql } = client(process.argv[2]);
const M = 'amountMicros currencyCode';
const ADDRESS = (street, city, postcode) => ({ addressStreet1: street, addressCity: city, addressPostcode: postcode, addressCountry: 'United Kingdom' });

const run = Date.now().toString(36);
const existingProfiles = (await gql(`{ businessProfiles(first: 1) { edges { node { id nextInvoiceNumber nextQuoteNumber } } } }`)).businessProfiles.edges;
if (existingProfiles.length === 0) await gql(`mutation($data: BusinessProfileCreateInput!) { createBusinessProfile(data: $data) { id } }`, { data: {
  legalName: 'Acme Plumbing Ltd', tradingName: 'Acme Plumbing & Heating', legalStructure: 'LIMITED_COMPANY', companyNumber: '12345678',
  registeredIn: 'ENGLAND_AND_WALES', registeredOfficeAddress: '10 Canal Street, Manchester M1 3HE', businessAddress: ADDRESS('Unit 4, Mill Lane', 'Manchester', 'M4 6AB'),
  vatRegistered: true, vatNumber: 'GB123456789', email: 'accounts@acmeplumbing.test', phone: '0161 000 0000', bankName: 'Barclays', bankAccountName: 'Acme Plumbing Ltd',
  sortCode: '20-00-00', accountNumber: '12345678', invoicePrefix: 'ACME-', quotePrefix: 'Q-', creditNotePrefix: 'CN-', defaultPaymentTermsDays: 14 } });
const profileNow = (await gql(`{ businessProfiles(first: 1, orderBy: [{ createdAt: AscNullsFirst }]) { edges { node { nextInvoiceNumber nextQuoteNumber } } } }`)).businessProfiles.edges[0].node;
const expectedQuoteNumber = `Q-${String(profileNow.nextQuoteNumber).padStart(4, '0')}`;
const expectedInvoiceNumber = `ACME-${String(profileNow.nextInvoiceNumber).padStart(4, '0')}`;

const { createCompany } = await gql(`mutation($data: CompanyCreateInput!) { createCompany(data: $data) { id } }`, { data: { name: `Northern Lettings Ltd ${run}`, address: ADDRESS('22 Oxford Road', 'Manchester', 'M13 9PL'), vatNumber: 'GB987654321' } });
const { createPerson } = await gql(`mutation($data: PersonCreateInput!) { createPerson(data: $data) { id } }`, { data: { name: { firstName: 'Priya', lastName: 'Shah' }, emails: { primaryEmail: `priya.${run}@northernlettings.test` }, companyId: createCompany.id } });
const existingProducts = (await gql(`{ products(first: 50) { edges { node { id name } } } }`)).products.edges.map((edge) => edge.node);
const { createProducts } = existingProducts.length >= 3 ? { createProducts: existingProducts } : await gql(`mutation($data: [ProductCreateInput!]!) { createProducts(data: $data) { id name } }`, { data: [
  { name: 'Boiler service', description: 'Annual gas boiler service and safety check (Gas Safe registered engineer)', unitPrice: { amountMicros: 95_000_000, currencyCode: 'GBP' }, vatRate: 'STANDARD_20', unit: 'visit' },
  { name: 'Labour', description: 'Plumbing labour', unitPrice: { amountMicros: 45_000_000, currencyCode: 'GBP' }, vatRate: 'STANDARD_20', unit: 'hour' },
  { name: 'Energy-saving materials', description: 'Thermostatic radiator valves (energy-saving materials, reduced rate)', unitPrice: { amountMicros: 18_500_000, currencyCode: 'GBP' }, vatRate: 'REDUCED_5', unit: 'item' },
] });
const product = Object.fromEntries(createProducts.map((item) => [item.name, item.id]));

const { createQuote } = await gql(`mutation($data: QuoteCreateInput!) { createQuote(data: $data) { id } }`, { data: { name: 'Draft quote', title: 'Boiler service and radiator valves, 22 Oxford Road', companyId: createCompany.id, personId: createPerson.id } });
await gql(`mutation($data: [QuoteLineCreateInput!]!) { createQuoteLines(data: $data) { id } }`, { data: [
  { quoteId: createQuote.id, productId: product['Boiler service'], quantity: 1, lineOrder: 0 },
  { quoteId: createQuote.id, productId: product['Labour'], quantity: 2.5, lineOrder: 1 },
  { quoteId: createQuote.id, productId: product['Energy-saving materials'], quantity: 4, discountPercent: 10, lineOrder: 2 },
] });

// Expected: 95.00 + 112.50 = 207.50 @20% = 41.50 VAT; 4 x 18.50 less 10% = 66.60 @5% = 3.33 VAT; total 318.93
const quoteTotals = await waitFor('quote totals', async () => {
  const { quotes } = await gql(`query($id: UUID!) { quotes(filter: { id: { eq: $id } }) { edges { node { subtotal { ${M} } vatTotal { ${M} } total { ${M} } lines { edges { node { description netAmount { ${M} } vatRate unitPrice { ${M} } } } } } } } }`, { id: createQuote.id });
  const quote = quotes.edges[0].node;
  return pounds(quote.total) === '318.93' ? quote : null;
}, 90000).catch((error) => ({ error: error.message }));
assert('quote lines filled from price list and totals calculated', !quoteTotals.error, quoteTotals.error ?? `subtotal £${pounds(quoteTotals.subtotal)}, VAT £${pounds(quoteTotals.vatTotal)}, total £${pounds(quoteTotals.total)}`);
if (!quoteTotals.error) assert('line descriptions came from products', quoteTotals.lines.edges.every((edge) => edge.node.description?.length > 3), quoteTotals.lines.edges.map((edge) => `${edge.node.description.slice(0, 25)}=£${pounds(edge.node.netAmount)}`).join('; '));

await gql(`mutation($id: UUID!) { updateQuote(id: $id, data: { status: SENT }) { id } }`, { id: createQuote.id });
const sentQuote = await waitFor('quote PDF', async () => {
  const { quotes } = await gql(`query($id: UUID!) { quotes(filter: { id: { eq: $id } }) { edges { node { name quoteNumber status validUntil complianceIssues pdf { fileId label } } } } }`, { id: createQuote.id });
  const quote = quotes.edges[0].node;
  return quote.pdf?.length || quote.complianceIssues ? quote : null;
}, 90000);
assert('sending a quote numbers it and stores the PDF', sentQuote.quoteNumber === expectedQuoteNumber && sentQuote.pdf?.length === 1, `${sentQuote.quoteNumber} ${sentQuote.pdf?.[0]?.label ?? ''} valid until ${sentQuote.validUntil} ${sentQuote.complianceIssues ?? ''}`);

await gql(`mutation($id: UUID!) { updateQuote(id: $id, data: { status: ACCEPTED }) { id } }`, { id: createQuote.id });
const invoice = await waitFor('invoice from quote', async () => {
  const { invoices } = await gql(`query($id: UUID!) { invoices(filter: { sourceQuoteId: { eq: $id } }) { edges { node { id status total { ${M} } lines { edges { node { id } } } } } } }`, { id: createQuote.id });
  const found = invoices.edges[0]?.node;
  return found && found.lines.edges.length === 3 && pounds(found.total) === '318.93' ? found : null;
}, 90000);
const { quotes: afterAccept } = await gql(`query($id: UUID!) { quotes(filter: { id: { eq: $id } }) { edges { node { status } } } }`, { id: createQuote.id });
assert('accepting the quote creates a draft invoice with the same lines and totals', invoice.status === 'DRAFT' && afterAccept.edges[0].node.status === 'CONVERTED', `invoice total £${pounds(invoice.total)}, quote status ${afterAccept.edges[0].node.status}`);

await gql(`mutation($id: UUID!) { updateInvoice(id: $id, data: { status: ISSUED }) { id } }`, { id: invoice.id });
const issued = await waitFor('issued invoice', async () => {
  const { invoices } = await gql(`query($id: UUID!) { invoices(filter: { id: { eq: $id } }) { edges { node { name invoiceNumber status template issueDate supplyDate dueDate complianceIssues subtotal { ${M} } vatTotal { ${M} } total { ${M} } pdf { fileId label } } } } }`, { id: invoice.id });
  const node = invoices.edges[0].node;
  return node.pdf?.length || node.complianceIssues ? node : null;
}, 90000);
assert('issuing numbers the invoice, sets dates and stores the PDF', issued.invoiceNumber === expectedInvoiceNumber && issued.status === 'ISSUED' && issued.pdf?.length === 1 && Boolean(issued.dueDate),
  `${issued.invoiceNumber} ${issued.template} issued ${issued.issueDate} tax point ${issued.supplyDate} due ${issued.dueDate} total £${pounds(issued.total)} ${issued.complianceIssues ?? ''}`);

const companyAttachments = (await gql(`query($id: UUID!) { attachments(filter: { targetCompanyId: { eq: $id } }) { edges { node { name } } } }`, { id: createCompany.id })).attachments.edges.map((edge) => edge.node.name);
const personAttachments = (await gql(`query($id: UUID!) { attachments(filter: { targetPersonId: { eq: $id } }) { edges { node { name } } } }`, { id: createPerson.id })).attachments.edges.map((edge) => edge.node.name);
assert('quote and invoice PDFs are on the client company card', companyAttachments.includes(`Quote ${expectedQuoteNumber}.pdf`) && companyAttachments.includes(`Invoice ${expectedInvoiceNumber}.pdf`), companyAttachments.join(', '));
assert('quote and invoice PDFs are on the contact card', personAttachments.includes(`Quote ${expectedQuoteNumber}.pdf`) && personAttachments.includes(`Invoice ${expectedInvoiceNumber}.pdf`), personAttachments.join(', '));

writeFileSync('inv-state.json', JSON.stringify({ companyId: createCompany.id, personId: createPerson.id, invoiceId: invoice.id, quoteId: createQuote.id, products: product }, null, 2));
summary();
