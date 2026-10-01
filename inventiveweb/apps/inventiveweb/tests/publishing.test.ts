import test from 'node:test';
import assert from 'node:assert/strict';
import { publishForm, selectServiceForm, FormActionError, type FormRepository, type PublishedForm, type Actor } from '../src/domain/form-publishing.ts';

const formId = 'e5f23c45-f747-48d6-91a4-189e59b957d1';
const serviceId = '8b54fb81-38eb-44e8-adf9-f87605f6c92d';
const versionId = '4d679bec-cdcd-472c-92a7-f1db7caf2bf9';
const actor: Actor = { workspaceId: 'workspace-a', userWorkspaceId: 'user-a', workspaceMemberId: 'member-a' };
const schema = () => ({ schemaVersion: 1, fields: [{ key: 'email', label: 'Email', type: 'email', required: true, visibility: 'customer' }] });
const expectedDraft = () => ({ name: 'Consultation', purpose: 'APPOINTMENT', schema: schema() });
const request = () => ({ formId, expectedDraft: expectedDraft() });

function fixture() {
  const rows: PublishedForm[] = [];
  const calls: string[] = [];
  let savedVersion: string | undefined;
  const repository: FormRepository = {
    async assertCanUpdateForm() { calls.push('authorize'); },
    async readDraft(id) { calls.push('read'); return { id, name: 'Consultation', purpose: 'APPOINTMENT', schemaJson: schema() }; },
    async findSnapshot(key) { return structuredClone(rows.find(row => row.snapshotKey === key) ?? null); },
    async latestVersion(id) { return Math.max(0, ...rows.filter(row => row.formId === id).map(row => row.version)); },
    async createSnapshot(snapshot) {
      calls.push('insert');
      if (rows.some(row => row.snapshotKey === snapshot.snapshotKey || (row.formId === snapshot.formId && row.version === snapshot.version))) throw new Error('unique violation');
      const row = { id: versionId, ...structuredClone(snapshot) }; rows.push(row); return structuredClone(row);
    },
    async readService(id) { return { id, name: 'Consultation', formId }; },
    async readPublished() { return structuredClone(rows[0]!); },
    async setServiceVersion(_serviceId, id) { calls.push('select'); savedVersion = id; },
  };
  return { repository, rows, calls, selected: () => savedVersion };
}
const errorWithStatus = (status: number) => (error: unknown) => error instanceof FormActionError && error.status === status;

test('anonymous or machine invocation cannot reach the repository', async () => {
  const { repository, calls } = fixture();
  await assert.rejects(publishForm(request(), { ...actor, workspaceMemberId: null }, repository), errorWithStatus(403));
  assert.deepEqual(calls, []);
});
test('read-only role is rejected before any elevated snapshot access', async () => {
  const { repository, calls } = fixture();
  repository.assertCanUpdateForm = async () => { throw new FormActionError('Denied', 403); };
  repository.findSnapshot = async () => { assert.fail('Must not read as application'); };
  await assert.rejects(publishForm(request(), actor, repository), errorWithStatus(403));
  assert.deepEqual(calls, []);
});
test('stale or unsaved editor content cannot publish a different saved draft', async () => {
  const { repository, calls } = fixture();
  const input = request(); input.expectedDraft.name = 'Unsaved name';
  await assert.rejects(publishForm(input, actor, repository), errorWithStatus(409));
  assert(!calls.includes('insert'));
});
test('publishes server content with server actor and timestamp; retries reuse the revision', async () => {
  const { repository, rows } = fixture();
  const first = await publishForm({ ...request(), publishedBy: 'attacker', version: 99, workspaceId: 'workspace-b' }, actor, repository, () => '2026-09-30T06:00:00.000Z');
  const second = await publishForm(request(), actor, repository);
  assert.equal(rows.length, 1); assert.equal(first.reused, false); assert.equal(second.reused, true);
  assert.equal(first.published.version, 1); assert.equal(first.published.publishedBy, 'member-a');
  assert.equal(first.published.publishedAt, '2026-09-30T06:00:00.000Z');
});
test('later drafts create independent snapshots without rewriting previous versions', async () => {
  const { repository, rows } = fixture();
  await publishForm(request(), actor, repository);
  repository.readDraft = async id => ({ id, name: 'Changed', purpose: 'APPOINTMENT', schemaJson: schema() });
  const input = request(); input.expectedDraft.name = 'Changed';
  const result = await publishForm(input, actor, repository);
  assert.equal(result.published.version, 2); assert.equal(rows[0]!.name, 'Consultation · v1');
  assert.notEqual(rows[0]!.snapshotKey, rows[1]!.snapshotKey);
});
test('concurrent identical publication requests converge on one unique snapshot', async () => {
  const { repository, rows } = fixture();
  const results = await Promise.all(Array.from({ length: 12 }, () => publishForm(request(), actor, repository)));
  assert.equal(rows.length, 1); assert(results.every(result => result.published.snapshotKey === rows[0]!.snapshotKey));
});
test('a different publication taking the same version number advances the retry', async () => {
  const { repository, rows } = fixture();
  const insert = repository.createSnapshot;
  let first = true;
  repository.createSnapshot = async snapshot => {
    if (first) { first = false; rows.push({ ...snapshot, id: versionId, snapshotKey: 'other-publication' }); throw new Error('unique version race'); }
    return insert(snapshot);
  };
  assert.equal((await publishForm(request(), actor, repository)).published.version, 2);
});
test('a lost response after commit is recovered without creating a second revision', async () => {
  const { repository, rows } = fixture();
  const insert = repository.createSnapshot;
  repository.createSnapshot = async snapshot => { await insert(snapshot); throw new Error('connection lost'); };
  const result = await publishForm(request(), actor, repository);
  assert.equal(result.reused, true); assert.equal(rows.length, 1);
});
test('uncommitted transport failures are not silently reported as publication', async () => {
  const { repository, rows } = fixture();
  repository.createSnapshot = async () => { throw new Error('offline'); };
  await assert.rejects(publishForm(request(), actor, repository), /offline/); assert.equal(rows.length, 0);
});
test('empty and malformed definitions never publish', async () => {
  const { repository, rows } = fixture();
  await assert.rejects(publishForm({ formId, expectedDraft: { ...expectedDraft(), schema: { schemaVersion: 1, fields: [] } } }, actor, repository), errorWithStatus(400));
  await assert.rejects(publishForm({ ...request(), formId: '../another-workspace' }, actor, repository), errorWithStatus(400));
  assert.equal(rows.length, 0);
});
test('a service accepts only its own published appointment form', async () => {
  const { repository, rows, selected } = fixture();
  await publishForm(request(), actor, repository);
  await selectServiceForm({ serviceId, versionId }, actor, repository); assert.equal(selected(), versionId);
  rows[0]!.purpose = 'QUOTE';
  await assert.rejects(selectServiceForm({ serviceId, versionId }, actor, repository), errorWithStatus(400));
  rows[0]!.purpose = 'APPOINTMENT'; rows[0]!.formId = 'different-form';
  await assert.rejects(selectServiceForm({ serviceId, versionId }, actor, repository), errorWithStatus(400));
});
test('service selection keeps native write denial and does not elevate the caller', async () => {
  const { repository, selected } = fixture();
  await publishForm(request(), actor, repository);
  repository.setServiceVersion = async () => { throw new FormActionError('Native permission denied', 403); };
  await assert.rejects(selectServiceForm({ serviceId, versionId }, actor, repository), errorWithStatus(403));
  assert.equal(selected(), undefined);
});
