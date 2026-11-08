import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { evaluateExactGate } from '../src/fitment-v1/policy/gate.js';

test('authoritative EXACT requires exactly one candidate', () => {
  for (const candidateCount of [0, 1, 2]) {
    const result = evaluateExactGate({ vehicleIdentityResolved: true, applicationEdgeAuthoritative: true, oeGlassEdgeAuthoritativeOrIndependent: true, materialConflicts: [], candidateCount });
    assert.equal(result.passed, candidateCount === 1);
    assert.equal(result.authoritativeDataExact, candidateCount === 1);
  }
});
