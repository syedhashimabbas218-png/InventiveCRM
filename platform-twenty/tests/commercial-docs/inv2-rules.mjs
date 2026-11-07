import http from 'node:http';
import { readFileSync } from 'node:fs';
import { assert, client, pounds, summary, waitFor } from './inv-lib.mjs';
const keyFile = process.argv[2];
const { gql, key } = client(keyFile);
const M = 'amountMicros currencyCode';
const state = JSON.parse(readFileSync('inv-state.json', 'utf8'));
const run = Date.now().toString(36);
const ADDRESS = { addressStreet1: '5 Station Road', addressCity: 'Leeds', addressPostcode: 'LS1 4AB', addressCountry: 'United Kingdom' };
const INVOICE = `id name invoiceNumber status template kind issueDate dueDate nextRecurrenceDate isRecurring complianceIssues subtotal { ${M} } vatTotal { ${M} } total { ${M} } amountPaid { ${M} } paidDate pdf { label }`;
const getInvoice = async (id) => (await gql(`query($id: UUID!) { invoices(filter: { id: { eq: $id } }) { edges { node { ${INVOICE} } } } }`, { id })).invoices.edges[0].node;
const createInvoice = async (data, lines) => {
  const { createInvoice } = await gql(`mutation($data: InvoiceCreateInput!) { createInvoice(data: $data) { id } }`, { data: { name: 'Draft', ...data } });
  await gql(`mutation($data: [InvoiceLineCreateInput!]!) { createInvoiceLines(data: $data) { id } }`, { data: lines.map((line, index) => ({ ...line, invoiceId: createInvoice.id, lineOrder: index })) });
  return createInvoice.id;
};
const issueAndWait = async (id, expectTotal) => {
  if (expectTotal) await waitFor('totals', async () => pounds((await getInvoice(id)).total) === expectTotal, 60000);
  await gql(`mutation($id: UUID!) { updateInvoice(id: $id, data: { status: ISSUED }) { id } }`, { id });
  return waitFor('issue result', async () => { const invoice = await getInvoice(id); return invoice.pdf?.length || invoice.complianceIssues ? invoice : null; }, 60000);
};
const money = (pence) => ({ amountMicros: pence * 10_000, currencyCode: 'GBP' });

// 1. A client with no address cannot receive a VAT invoice.
const { createCompany: noAddress } = await gql(`mutation($data: CompanyCreateInput!) { createCompany(data: $data) { id } }`, { data: { name: `Walk-in Customer ${run}` } });
const blockedId = await createInvoice({ companyId: noAddress.id, template: 'UK_VAT_INVOICE' }, [{ description: 'Emergency call-out', quantity: 1, unitPrice: money(12_000), vatRate: 'STANDARD_20' }]);
const blocked = await issueAndWait(blockedId, '144.00');
assert('VAT invoice without a customer address is held back as Draft with the reason', blocked.status === 'DRAFT' && !blocked.invoiceNumber && /customer's address/.test(blocked.complianceIssues), blocked.complianceIssues.split('\n')[0]);

// 2. Domestic reverse charge for construction work (CIS): VAT shown, not charged.
const { createCompany: builder } = await gql(`mutation($data: CompanyCreateInput!) { createCompany(data: $data) { id } }`, { data: { name: `Yorkshire Builders Ltd ${run}`, address: ADDRESS, vatNumber: 'GB 555 1234 99' } });
const reverseId = await createInvoice({ companyId: builder.id, template: 'UK_REVERSE_CHARGE_INVOICE' }, [{ description: 'First fix plumbing, plots 4-6 (CIS)', quantity: 3, unitPrice: money(85_000), vatRate: 'STANDARD_20' }]);
const reverse = await issueAndWait(reverseId, '2550.00');
assert('reverse charge invoice shows VAT but the total excludes it', reverse.status === 'ISSUED' && pounds(reverse.vatTotal) === '510.00' && pounds(reverse.total) === '2550.00', `${reverse.invoiceNumber} net £${pounds(reverse.subtotal)} VAT £${pounds(reverse.vatTotal)} payable £${pounds(reverse.total)} ${reverse.complianceIssues}`);

// 3. Full credit note against the invoice from the first test voids it.
const original = await getInvoice(state.invoiceId);
const creditId = await createInvoice({ companyId: state.companyId, personId: state.personId, kind: 'CREDIT_NOTE', template: 'UK_VAT_INVOICE', creditedInvoiceId: state.invoiceId },
  [{ description: `Credit for ${original.invoiceNumber}: boiler service cancelled`, quantity: 1, unitPrice: money(26_579), vatRate: 'STANDARD_20' }]);
const credit = await issueAndWait(creditId);
const originalAfter = await waitFor('original voided', async () => { const invoice = await getInvoice(state.invoiceId); return invoice.status === 'VOID' ? invoice : null; }, 30000).catch(() => getInvoice(state.invoiceId));
assert('credit note gets its own CN- sequence and references the original', /^CN-\d{4}$/.test(credit.invoiceNumber) && credit.pdf?.[0]?.label?.startsWith('Credit note'), `${credit.invoiceNumber} total £${pounds(credit.total)} ${credit.complianceIssues}`);
assert('a full credit note voids the original invoice', originalAfter.status === 'VOID', `${original.invoiceNumber} is now ${originalAfter.status}`);

// 4. Recurring monthly invoice: the daily run creates and issues the next one.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
const recurringId = await createInvoice({ companyId: state.companyId, personId: state.personId, template: 'UK_VAT_INVOICE', isRecurring: true, recurrenceFrequency: 'MONTHLY', recurrenceInterval: 1, nextRecurrenceDate: today, autoIssueRecurring: true, notes: 'Monthly maintenance contract' },
  [{ description: 'Monthly heating maintenance plan', quantity: 1, unitPrice: money(4_900), vatRate: 'STANDARD_20' }]);
const recurringTemplate = await issueAndWait(recurringId, '58.80');
const callRoute = (host, path, body) => new Promise((resolve) => {
  const port = Number(new URL(process.env.SERVER_URL).port || 80);
  const request = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { Host: `${host}:${port}`, 'Content-Type': 'application/json', Authorization: `Bearer ${key}` } }, (response) => {
    let data = ''; response.on('data', (chunk) => (data += chunk)); response.on('end', () => resolve({ status: response.statusCode, body: data }));
  });
  request.end(JSON.stringify(body));
});
const host = process.argv[3];
const runResult = await callRoute(host, '/s/billing/daily-run', {});
console.log('  daily run:', runResult.status, runResult.body.slice(0, 200));
const child = await waitFor('recurring child issued', async () => {
  const { invoices } = await gql(`query($id: UUID!) { invoices(filter: { recurringParentId: { eq: $id } }) { edges { node { ${INVOICE} } } } }`, { id: recurringId });
  const node = invoices.edges[0]?.node;
  return node?.pdf?.length || node?.complianceIssues ? node : null;
}, 90000).catch((error) => ({ error: error.message }));
const templateAfter = await getInvoice(recurringId);
assert('daily run creates and issues the recurring invoice with the client PDF', child.status === 'ISSUED' && child.pdf?.length === 1 && pounds(child.total) === '58.80', child.error ?? `${child.invoiceNumber} total £${pounds(child.total)} issued ${child.issueDate} ${child.complianceIssues}`);
assert('the recurring schedule moves to next month', templateAfter.nextRecurrenceDate > today, `${recurringTemplate.invoiceNumber} next ${templateAfter.nextRecurrenceDate}`);
const second = await callRoute(host, '/s/billing/daily-run', {});
const children = (await gql(`query($id: UUID!) { invoices(filter: { recurringParentId: { eq: $id } }) { edges { node { id } } } }`, { id: recurringId })).invoices.edges.length;
assert('running the daily job twice the same day does not duplicate', children === 1, `children=${children}, second run ${second.body.slice(0, 120)}`);

// 5. Overdue and paid.
const lateId = await createInvoice({ companyId: state.companyId, template: 'UK_VAT_INVOICE', issueDate: '2026-09-01', supplyDate: '2026-09-01', paymentTermsDays: 30 }, [{ description: 'Leak repair', quantity: 1, unitPrice: money(15_000), vatRate: 'STANDARD_20' }]);
await issueAndWait(lateId, '180.00');
await callRoute(host, '/s/billing/daily-run', {});
const late = await waitFor('overdue', async () => { const invoice = await getInvoice(lateId); return invoice.status === 'OVERDUE' ? invoice : null; }, 30000).catch(() => getInvoice(lateId));
assert('an unpaid invoice past its due date becomes Overdue', late.status === 'OVERDUE', `${late.invoiceNumber} due ${late.dueDate} is ${late.status}`);
await gql(`mutation($id: UUID!) { updateInvoice(id: $id, data: { status: PAID }) { id } }`, { id: lateId });
const paid = await waitFor('paid details', async () => { const invoice = await getInvoice(lateId); return invoice.paidDate ? invoice : null; }, 30000).catch(() => getInvoice(lateId));
assert('marking Paid records the payment date and amount', paid.paidDate === today && pounds(paid.amountPaid) === '180.00', `paid ${paid.paidDate} £${pounds(paid.amountPaid)}`);

summary();
