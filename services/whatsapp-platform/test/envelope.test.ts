import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseEnvelope } from '../src/envelope/envelope.ts';

const validEnvelope = () => ({
  tenant_id: 'tnt_abc12345',
  actor: { type: 'agent', id: 'agent_1' },
  correlation_id: 'cor_abc12345',
  idempotency_key: 'idem-1',
  occurred_at: '2026-11-03T10:15:00.000Z',
  payload: { text: 'hello' },
});

describe('parseEnvelope', () => {
  it('accepts a well-formed envelope', () => {
    const result = parseEnvelope(validEnvelope());
    assert.equal(result.ok, true);
  });

  it('accepts an offset timestamp', () => {
    const result = parseEnvelope({ ...validEnvelope(), occurred_at: '2026-11-03T10:15:00+01:00' });
    assert.equal(result.ok, true);
  });

  for (const field of ['tenant_id', 'actor', 'correlation_id', 'idempotency_key', 'occurred_at', 'payload'] as const) {
    it(`rejects a missing ${field}`, () => {
      const envelope: Record<string, unknown> = validEnvelope();
      delete envelope[field];
      const result = parseEnvelope(envelope);
      assert.equal(result.ok, false);
    });
  }

  it('rejects a malformed tenant id', () => {
    for (const tenantId of ['', 'tnt_', 'abc12345', 'tnt_abc;drop', 'tnt_abc12345 ', 42]) {
      const result = parseEnvelope({ ...validEnvelope(), tenant_id: tenantId });
      assert.equal(result.ok, false, `accepted ${String(tenantId)}`);
    }
  });

  it('rejects an unknown actor type', () => {
    const result = parseEnvelope({ ...validEnvelope(), actor: { type: 'admin', id: 'x' } });
    assert.deepEqual(result, { ok: false, errors: ['actor.type must be user, agent or system'] });
  });

  it('rejects a timestamp without a timezone', () => {
    const result = parseEnvelope({ ...validEnvelope(), occurred_at: '2026-11-03T10:15:00' });
    assert.equal(result.ok, false);
  });

  it('rejects unknown top-level fields', () => {
    const result = parseEnvelope({ ...validEnvelope(), permissions: ['all'] });
    assert.deepEqual(result, { ok: false, errors: ['unknown field: permissions'] });
  });

  it('rejects a non-object payload', () => {
    for (const payload of [null, 'text', [1, 2]]) {
      assert.equal(parseEnvelope({ ...validEnvelope(), payload }).ok, false);
    }
  });

  it('rejects an oversized idempotency key', () => {
    const result = parseEnvelope({ ...validEnvelope(), idempotency_key: 'x'.repeat(201) });
    assert.equal(result.ok, false);
  });
});
