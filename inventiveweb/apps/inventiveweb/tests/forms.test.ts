import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFormSchema, validateAnswers } from '../src/shared/forms.ts';
const field = (key: string, extra = {}) => ({ key, label: key, type: 'text', required: false, visibility: 'customer', ...extra });
const schema = (fields: unknown[]) => parseFormSchema({ schemaVersion: 1, fields });
test('rejects prototype keys and duplicate keys', () => {
  for (const key of ['constructor', '__proto__', 'prototype']) assert.throws(() => schema([field(key)]));
  assert.throws(() => schema([field('name'), field('name')]));
});
test('rejects cycles, forward references and staff-dependent public fields', () => {
  assert.throws(() => schema([field('a', { condition: { field: 'b', equals: 'x' } }), field('b')]));
  assert.throws(() => schema([field('internal', { visibility: 'staff' }), field('a', { condition: { field: 'internal', equals: 'x' } })]));
});
test('drops staff, hidden and injected answers from public submissions', () => {
  const s = schema([field('service', { type: 'select', options: ['repair', 'survey'] }), field('details', { required: true, condition: { field: 'service', equals: 'repair' } }), field('margin', { visibility: 'staff' })]);
  const result = validateAnswers(s, { service: 'survey', details: 'hidden', margin: '100', tenantId: 'other' }, 'customer');
  assert.equal(result.valid, true);
  assert.deepEqual(result.answers, { service: 'survey' });
  assert.equal(validateAnswers(s, { service: 'repair' }, 'customer').errors.details, 'Required');
});
test('checks real dates, choices and finite numeric values', () => {
  const s = schema([field('date', { type: 'date' }), field('amount', { type: 'number' }), field('choice', { type: 'select', options: ['yes'] })]);
  assert.equal(validateAnswers(s, { date: '2026-02-30', amount: Infinity, choice: 'no' }, 'customer').valid, false);
  assert.equal(validateAnswers(s, { date: '2028-02-29', amount: 0, choice: 'yes' }, 'customer').valid, true);
});
test('required checkbox is consent rather than a default false value', () => {
  const s = schema([field('consent', { type: 'checkbox', required: true })]);
  assert.equal(validateAnswers(s, { consent: false }, 'customer').valid, false);
  assert.equal(validateAnswers(s, { consent: true }, 'customer').valid, true);
});
test('published snapshots can be copied independently of later draft edits', () => {
  const draft = { schemaVersion: 1, fields: [field('name')] };
  const snapshot = parseFormSchema(draft);
  draft.fields[0]!.label = 'Changed';
  assert.equal(snapshot.fields[0]!.label, 'name');
});
