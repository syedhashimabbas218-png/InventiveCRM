import test from 'node:test';
import assert from 'node:assert/strict';
import { FormActionError } from '../src/domain/form-publishing.ts';

const record = 'a50dedee-d1f5-4d58-887e-9cbe9619d122';
const metadataId = 'f781fc99-8cff-4b06-a0a3-f3c3c56c3292';
const response = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });

test('native permission checks use the person token and reject missing or denied permissions', async context => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = { ...process.env };
  context.after(() => { globalThis.fetch = originalFetch; process.env = originalEnvironment; });
  process.env.TWENTY_API_URL = 'https://test.invalid';
  process.env.TWENTY_APP_ACCESS_TOKEN = 'test-person-token';
  process.env.TWENTY_APP_APPLICATION_ACCESS_TOKEN = 'test-application-token';
  let allowed = false;
  let missing = false;
  const requests: string[] = [];
  globalThis.fetch = async (input, options) => {
    assert.equal(new URL(String(input)).origin, 'https://test.invalid');
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer test-person-token');
    const query = JSON.parse(String(options?.body)).query as string;
    requests.push(query);
    if (query.includes('recordPermissions')) {
      return response({ data: { recordPermissions: missing ? [] : [{ recordId: record, objectMetadataId: metadataId, permissions: { canRead: true, canUpdate: allowed } }] } });
    }
    return response({ data: { objects: { edges: [{ node: { id: metadataId } }] } } });
  };
  const { createFormRepository } = await import('../src/infrastructure/twenty-form-repository.ts');
  const repository = createFormRepository();
  await assert.rejects(repository.assertCanUpdateForm(record), error => error instanceof FormActionError && error.status === 403);
  allowed = true;
  await repository.assertCanUpdateForm(record);
  missing = true;
  await assert.rejects(repository.assertCanUpdateForm(record), error => error instanceof FormActionError && error.status === 403);
  assert.equal(requests.length, 6);
});

test('snapshot writes use the application token; service selection uses caller token and a conditional filter', async context => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = { ...process.env };
  context.after(() => { globalThis.fetch = originalFetch; process.env = originalEnvironment; });
  process.env.TWENTY_API_URL = 'https://test.invalid';
  process.env.TWENTY_APP_ACCESS_TOKEN = 'test-person-token';
  process.env.TWENTY_APP_APPLICATION_ACCESS_TOKEN = 'test-application-token';
  let changed = false;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://test.invalid');
    if (options?.method === 'POST') {
      assert.equal(url.pathname, '/rest/iwFormVersions');
      assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer test-application-token');
      return response({ data: { createIwFormVersion: { id: record } } });
    }
    assert.equal(options?.method, 'PATCH');
    assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer test-person-token');
    assert.equal(url.searchParams.get('filter'), `and(id[eq]:${record},formId[eq]:${metadataId})`);
    return response({ data: { updateIwBookingServices: changed ? [] : [{ id: record }] } });
  };
  const { createFormRepository } = await import('../src/infrastructure/twenty-form-repository.ts');
  const repository = createFormRepository();
  await repository.createSnapshot({ formId: metadataId, name: 'Published', version: 1, snapshotKey: 'test', purpose: 'APPOINTMENT', schemaJson: { schemaVersion: 1, fields: [] }, publishedAt: '2026-09-30T06:00:00Z', publishedBy: record });
  await repository.setServiceVersion(record, record, metadataId);
  changed = true;
  await assert.rejects(repository.setServiceVersion(record, record, metadataId), error => error instanceof FormActionError && error.status === 409);
});
