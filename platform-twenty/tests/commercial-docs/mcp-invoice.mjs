// Simulates an AI assistant handling: "Invoice Northern Lettings for two hours of labour and issue it."
import { readFileSync } from 'node:fs';
import { assert, client, summary, waitFor } from './inv-lib.mjs';
// No default: a forgotten variable must not send test traffic to a live server on the usual port.
const SERVER_URL = process.env.SERVER_URL;
if (!SERVER_URL) throw new Error('Set SERVER_URL to the throwaway test server, for example http://localhost:3001');
const key = readFileSync(`${process.env.KEYS_DIR ?? 'keys'}/acme.key`, 'utf8').trim();
const state = JSON.parse(readFileSync('inv-state.json', 'utf8'));
let id = 0;
const rpc = async (method, params) => {
  const response = await fetch(`${SERVER_URL}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
  const text = await response.text();
  return JSON.parse(text.startsWith('{') ? text : text.split('\n').filter((line) => line.startsWith('data:')).pop().slice(5));
};
const tool = async (toolName, args) => {
  const reply = await rpc('tools/call', { name: 'execute_tool', arguments: { toolName, arguments: args } });
  return JSON.parse(reply.result.content[0].text);
};
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
const invoice = await tool('create_one_invoice', { name: 'Labour', companyId: state.companyId, personId: state.personId, template: 'UK_VAT_INVOICE' });
const invoiceId = invoice.result?.id ?? invoice.record?.id ?? invoice.result?.record?.id;
console.log('  create_one_invoice:', invoice.success, invoiceId ?? JSON.stringify(invoice).slice(0, 200));
const line = await tool('create_one_invoice_line', { invoiceId, productId: state.products['Labour'], quantity: 2 });
console.log('  create_one_invoice_line:', line.success, (line.message ?? '').slice(0, 100));
const { gql } = client(`${process.env.KEYS_DIR ?? 'keys'}/acme.key`);
await waitFor('line totals', async () => {
  const { invoices } = await gql(`query($id: UUID!) { invoices(filter: { id: { eq: $id } }) { edges { node { total { amountMicros } } } } }`, { id: invoiceId });
  return Number(invoices.edges[0].node.total?.amountMicros) === 108_000_000;
}, 60000);
const issue = await tool('app_issue-document', { invoiceId }).catch((error) => ({ error: error.message }));
const issueAlt = issue.success ? issue : await tool('app_issue_document', { invoiceId });
console.log('  app tool:', JSON.stringify(issue.success ? issue : issueAlt).slice(0, 200));
const issued = await waitFor('issued', async () => {
  const { invoices } = await gql(`query($id: UUID!) { invoices(filter: { id: { eq: $id } }) { edges { node { invoiceNumber status pdf { label } complianceIssues } } } }`, { id: invoiceId });
  const node = invoices.edges[0].node;
  return node.pdf?.length || node.complianceIssues ? node : null;
}, 60000);
assert('an AI assistant can create and issue an invoice through MCP', issued.status === 'ISSUED' && issued.pdf?.length === 1, `${issued.invoiceNumber} £108.00 ${issued.pdf?.[0]?.label ?? ''} ${issued.complianceIssues}`);
summary();
