import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApiClient } from './helpers/api-client.ts';
import type { SeededTenant } from './helpers/fixtures.ts';
import { createTestContext, type TestContext } from './helpers/test-context.ts';

let context: TestContext;
let api: ReturnType<typeof createApiClient>;
let tenant: SeededTenant;

const waitFor = async (condition: () => boolean, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

describe('process crash mid-send', () => {
  before(async () => {
    context = await createTestContext();
    api = createApiClient(context);
    tenant = await context.seedTenant('Ahmed Plumbing');
  });

  after(async () => {
    await context?.close();
  });

  it('a send process killed while Meta is answering leaves no lock behind and is never retried', async () => {
    const customer = '447700955501';
    const { conversationId, messageId } = await api.customerSays(tenant, customer, 'hello');
    context.advance(10_000);
    const claimId = (await api.claim(tenant, conversationId, messageId)).json().claim_id;
    const envelope = api.envelope(tenant.tenantId, { type: 'agent', id: 'agent' }, { conversation_id: conversationId, claim_id: claimId, type: 'text', body: 'Hi!' }, 'killed-key');

    context.mockGraph.mode = 'hang';
    const before = context.mockGraph.sends.length;
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(import.meta.dirname, 'helpers', 'crash-send-child.ts')], {
      env: {
        ...process.env,
        CHILD_DATABASE_URL: context.database.appUrl,
        CHILD_GRAPH_URL: context.mockGraph.url,
        CHILD_KEY_ID: context.tokenKey.id,
        CHILD_KEY: context.tokenKey.key.toString('base64'),
        CHILD_NOW: context.now.toISOString(),
        CHILD_ENVELOPE: JSON.stringify(envelope),
      },
      stdio: 'ignore',
    });
    const exited = new Promise((resolve) => child.on('exit', resolve));
    await waitFor(() => context.mockGraph.sends.length > before, 15_000);
    child.kill('SIGKILL');
    await exited;
    context.mockGraph.mode = 'ok';

    const humanReply = await api.humanSend(tenant, conversationId, 'Owner is not blocked by the dead process');
    assert.equal(humanReply.statusCode, 200);

    context.advance(60_000);
    const retry = await api.call('/v1/messages/send', tenant.apiToken, envelope);
    assert.equal(retry.statusCode, 409);
    assert.deepEqual(retry.json(), { reason: 'outcome_unknown' });
    const aiSends = context.mockGraph.sends.slice(before).filter((send) => (send.body.text as { body?: string })?.body === 'Hi!');
    assert.equal(aiSends.length, 1);
  });

  it('a claim held by a crashed run expires, after which a new run can claim', async () => {
    const customer = '447700955502';
    const { conversationId, messageId } = await api.customerSays(tenant, customer, 'hello');
    context.advance(10_000);
    assert.equal((await api.claim(tenant, conversationId, messageId)).statusCode, 200);
    assert.equal((await api.claim(tenant, conversationId, messageId)).json().reason, 'already_claimed');
    context.advance(121_000);
    assert.equal((await api.claim(tenant, conversationId, messageId)).statusCode, 200);
  });
});
