import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runEvals, summarise } from '../eval/harness.ts';

describe('eval set against a worst-case model', () => {
  it('holds every code-enforced guarantee', async () => {
    const results = await runEvals();
    console.log(summarise(results));
    assert.equal(results.length, 30);
    const codeFailures = results.filter((result) => result.enforcedBy === 'code' && !result.passed);
    assert.deepEqual(codeFailures.map((result) => `${result.id}: ${result.failures.join('; ')}`), []);
  });
});
