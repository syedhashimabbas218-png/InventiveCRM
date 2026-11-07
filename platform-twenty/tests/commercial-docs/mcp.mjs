// Minimal MCP (Streamable HTTP, JSON-RPC) client for testing: node mcp.mjs <keyFile> <method> [jsonParams]
import { readFileSync } from 'node:fs';
// No default: a forgotten variable must not send test traffic to a live server on the usual port.
const SERVER_URL = process.env.SERVER_URL;
if (!SERVER_URL) throw new Error('Set SERVER_URL to the throwaway test server, for example http://localhost:3001');
const [keyFile, method, params = '{}'] = process.argv.slice(2);
const key = readFileSync(keyFile, 'utf8').trim();
let id = 0;
const rpc = async (rpcMethod, rpcParams) => {
  const response = await fetch(`${SERVER_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: rpcMethod, params: rpcParams }),
  });
  const text = await response.text();
  const json = text.startsWith('{') ? JSON.parse(text) : JSON.parse(text.split('\n').filter((line) => line.startsWith('data:')).pop().slice(5));
  return { status: response.status, json };
};
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'inventivecrm-test', version: '1' } });
if (method === 'initialize') { console.log(JSON.stringify(init, null, 1)); process.exit(0); }
const result = await rpc(method, JSON.parse(params));
console.log(JSON.stringify(result.json, null, 1));
