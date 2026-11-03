import { assert, client, pounds, summary, waitFor } from './inv-lib.mjs';
const { gql } = client(process.argv[2]);
const M = 'amountMicros currencyCode';
const run = Date.now().toString(36);
const profiles = (await gql(`{ businessProfiles(first: 1) { edges { node { id } } } }`)).businessProfiles.edges;
if (profiles.length === 0) await gql(`mutation($data: BusinessProfileCreateInput!) { createBusinessProfile(data: $data) { id } }`, { data: {
  legalName: 'Jade Okafor', tradingName: 'Glow Beauty Salon', legalStructure: 'SOLE_TRADER', vatRegistered: false,
  businessAddress: { addressStreet1: '8 Market Place', addressCity: 'York', addressPostcode: 'YO1 8RS', addressCountry: 'United Kingdom' },
  email: 'hello@glowsalon.test', sortCode: '40-11-22', accountNumber: '87654321', invoicePrefix: 'GLOW-', defaultPaymentTermsDays: 7, includeLatePaymentNotice: false } });
const { createProduct } = await gql(`mutation($data: ProductCreateInput!) { createProduct(data: $data) { id } }`, { data: { name: `Bridal package ${run}`, description: 'Bridal hair and make-up with trial session', unitPrice: { amountMicros: 320_000_000, currencyCode: 'GBP' }, vatRate: 'STANDARD_20', unit: 'package' } });
const { createPerson } = await gql(`mutation($data: PersonCreateInput!) { createPerson(data: $data) { id } }`, { data: { name: { firstName: 'Emma', lastName: 'Clarke' }, emails: { primaryEmail: `emma.${run}@example.test` } } });
const { createInvoice } = await gql(`mutation($data: InvoiceCreateInput!) { createInvoice(data: $data) { id } }`, { data: { name: 'Draft', personId: createPerson.id } });
await gql(`mutation($data: [InvoiceLineCreateInput!]!) { createInvoiceLines(data: $data) { id } }`, { data: [{ invoiceId: createInvoice.id, productId: createProduct.id, quantity: 1 }] });
const get = async () => (await gql(`query($id: UUID!) { invoices(filter: { id: { eq: $id } }) { edges { node { invoiceNumber status template vatTotal { ${M} } total { ${M} } complianceIssues pdf { label } lines { edges { node { vatRate } } } } } } }`, { id: createInvoice.id })).invoices.edges[0].node;
const draft = await waitFor('totals', async () => { const invoice = await get(); return pounds(invoice.total) === '320.00' ? invoice : null; }, 60000);
assert('price list VAT is ignored for a business that is not VAT registered', draft.lines.edges[0].node.vatRate === 'NO_VAT' && pounds(draft.vatTotal) === '0.00', `line VAT rate ${draft.lines.edges[0].node.vatRate}, total £${pounds(draft.total)}`);
await gql(`mutation($id: UUID!) { updateInvoice(id: $id, data: { status: ISSUED }) { id } }`, { id: createInvoice.id });
const issued = await waitFor('issued', async () => { const invoice = await get(); return invoice.pdf?.length || invoice.complianceIssues ? invoice : null; }, 60000);
assert('non-VAT invoice issues with the non-VAT template to a private client', issued.status === 'ISSUED' && issued.template === 'UK_NON_VAT_INVOICE' && /^GLOW-\d{4}$/.test(issued.invoiceNumber), `${issued.invoiceNumber} ${issued.template} ${issued.complianceIssues}`);
const attachments = (await gql(`query($id: UUID!) { attachments(filter: { targetPersonId: { eq: $id } }) { edges { node { name } } } }`, { id: createPerson.id })).attachments.edges.map((edge) => edge.node.name);
assert('invoice PDF is on the client person card', attachments.includes(`Invoice ${issued.invoiceNumber}.pdf`), attachments.join(', '));
console.log('NUMBER', issued.invoiceNumber);
summary();
