import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApiClient } from './helpers/api-client.ts';
import type { SeededTenant } from './helpers/fixtures.ts';
import { createTestContext, type TestContext } from './helpers/test-context.ts';

let context: TestContext;
let api: ReturnType<typeof createApiClient>;
let plumber: SeededTenant;
let dentist: SeededTenant;
let customerSequence = 0;
const newCustomer = () => `4477005${String(10000 + ++customerSequence)}`;

const rpc = (tenant: SeededTenant, body: unknown, headers: Record<string, string> = {}, path = `/mcp/${tenant.tenantId}`) =>
  context.app.inject({
    method: 'POST',
    url: path,
    headers: { authorization: `Bearer ${tenant.apiToken}`, accept: 'application/json, text/event-stream', ...headers },
    payload: body as object,
  });

const callTool = async (tenant: SeededTenant, name: string, args: Record<string, unknown>) => {
  const response = await rpc(tenant, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  return response.json().result as { isError: boolean; structuredContent: Record<string, unknown> };
};

describe('MCP endpoint', () => {
  before(async () => {
    context = await createTestContext({ mcpAllowedOrigins: ['https://console.example'] });
    api = createApiClient(context);
    plumber = await context.seedTenant('Ahmed Plumbing');
    dentist = await context.seedTenant('Bright Dental');
  });

  after(async () => {
    await context?.close();
  });

  it('requires a credential for this tenant that may act as an agent', async () => {
    const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } } };
    const unauthenticated = await context.app.inject({ method: 'POST', url: `/mcp/${plumber.tenantId}`, payload: initialize });
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(unauthenticated.headers['www-authenticate'], 'Bearer');
    assert.equal((await rpc(dentist, initialize, {}, `/mcp/${plumber.tenantId}`)).statusCode, 403);
    const inbox = await context.app.inject({
      method: 'POST',
      url: `/mcp/${plumber.tenantId}`,
      headers: { authorization: `Bearer ${plumber.inboxToken}` },
      payload: initialize,
    });
    assert.equal(inbox.statusCode, 403);
  });

  it('validates Origin, protocol version, method and message shape', async () => {
    const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
    assert.equal((await rpc(plumber, ping, { origin: 'https://evil.example' })).statusCode, 403);
    assert.equal((await rpc(plumber, ping, { origin: 'https://console.example' })).statusCode, 200);
    assert.equal((await rpc(plumber, ping, { 'mcp-protocol-version': '1999-01-01' })).statusCode, 400);
    assert.equal((await rpc(plumber, [ping])).statusCode, 400);
    assert.equal((await rpc(plumber, { jsonrpc: '2.0', method: 'notifications/initialized' })).statusCode, 202);
    const get = await context.app.inject({ method: 'GET', url: `/mcp/${plumber.tenantId}`, headers: { authorization: `Bearer ${plumber.apiToken}` } });
    assert.equal(get.statusCode, 405);
    assert.deepEqual((await rpc(plumber, { jsonrpc: '2.0', id: 9, method: 'resources/list' })).json().error.code, -32601);
  });

  it('negotiates the protocol version and lists only messaging tools', async () => {
    const init = await rpc(plumber, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    assert.equal(init.json().result.protocolVersion, '2025-06-18');
    assert.deepEqual(init.json().result.capabilities, { tools: { listChanged: false } });
    const list = await rpc(plumber, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.deepEqual(
      list.json().result.tools.map((tool: { name: string }) => tool.name),
      ['list_conversations', 'get_conversation', 'get_messages', 'claim_conversation', 'release_claim', 'send_message', 'request_handoff', 'list_templates'],
    );
  });

  it('runs the claim-then-send flow with the same lock rules as REST', async () => {
    const customer = newCustomer();
    const { conversationId, messageId } = await api.customerSays(plumber, customer, 'Do you fix boilers?');
    context.advance(10_000);

    const waiting = await callTool(plumber, 'list_conversations', { awaiting_reply: true });
    assert.ok((waiting.structuredContent.conversations as { id: string }[]).some((row) => row.id === conversationId));
    const messages = await callTool(plumber, 'get_messages', { conversation_id: conversationId });
    assert.equal((messages.structuredContent.messages as { body: string }[])[0]?.body, 'Do you fix boilers?');

    const claimed = await callTool(plumber, 'claim_conversation', { conversation_id: conversationId, latest_message_id: messageId });
    assert.equal(claimed.isError, false);
    const claimId = claimed.structuredContent.claim_id as string;
    const sent = await callTool(plumber, 'send_message', { conversation_id: conversationId, claim_id: claimId, idempotency_key: 'mcp-1', type: 'text', body: 'Yes we do.' });
    assert.equal(sent.isError, false, JSON.stringify(sent));
    assert.equal(context.mockGraph.sends.at(-1)?.body.to, customer);

    await api.humanSend(plumber, conversationId, 'Owner here.');
    const refused = await callTool(plumber, 'send_message', { conversation_id: conversationId, claim_id: claimId, idempotency_key: 'mcp-2', type: 'text', body: 'More AI text' });
    assert.deepEqual([refused.isError, refused.structuredContent.reason], [true, 'human_active']);
  });

  it('reports bad arguments and unknown tools without acting', async () => {
    const extra = await callTool(plumber, 'get_conversation', { conversation_id: 'cnv_x', tenant_id: dentist.tenantId });
    assert.deepEqual([extra.isError, extra.structuredContent.errors], [true, ['unknown argument: tenant_id']]);
    const unknown = await rpc(plumber, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'delete_everything', arguments: {} } });
    assert.equal(unknown.json().error.code, -32602);
  });

  it('cannot see or act on another tenant conversation', async () => {
    const { conversationId, messageId } = await api.customerSays(dentist, newCustomer(), 'hello');
    context.advance(10_000);
    assert.equal((await callTool(plumber, 'get_messages', { conversation_id: conversationId })).structuredContent.reason, 'not_found');
    assert.equal((await callTool(plumber, 'claim_conversation', { conversation_id: conversationId, latest_message_id: messageId })).structuredContent.reason, 'not_found');
    const listed = await callTool(plumber, 'list_conversations', {});
    assert.ok(!(listed.structuredContent.conversations as { id: string }[]).some((row) => row.id === conversationId));
  });

  it('works with the official MCP SDK client over real HTTP', async () => {
    const url = await context.app.listen({ port: 0, host: '127.0.0.1' });
    const client = new Client({ name: 'interop-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp/${plumber.tenantId}`), {
      requestInit: { headers: { authorization: `Bearer ${plumber.apiToken}` } },
    });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.ok(tools.tools.some((tool) => tool.name === 'send_message'));
      const { conversationId } = await api.customerSays(plumber, newCustomer(), 'Hi from the SDK test');
      const result = await client.callTool({ name: 'get_conversation', arguments: { conversation_id: conversationId } });
      assert.equal((result.structuredContent as { id: string }).id, conversationId);
      assert.equal(result.isError, false);
    } finally {
      await client.close();
    }
  });
});
