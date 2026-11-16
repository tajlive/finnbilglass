import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOffline100Benchmark } from '../scripts/benchmark-100-no-glavista.mjs';

test('100-source-car benchmark runs completely offline against all six checked-in price-list parts', () => {
  const result = runOffline100Benchmark();
  const s = result.stats;
  assert.equal(s.evaluatedVehicles, 100, 'exactly first 100, not cherry picked');
  assert.ok(s.sourceVehicles >= 100, 'the checked-in source has sufficient records');
  assert.equal(s.inputCompleteness, 100);
  assert.equal(s.catalogueSqlFiles, 6);
  assert.ok(s.catalogueAllRows >= 1000, 'the actual price-list import must be loaded');
  assert.ok(s.indexedCandidateRows > 0, 'the existing own product index must be present');
  assert.equal(s.withGlassCandidates + s.withoutGlassCandidates, 100);
  assert.equal(s.exactlyOneCandidate + s.multipleCandidates, s.withGlassCandidates);
  assert.equal(s.autoExactApproved, 0, 'catalogue evidence cannot approve a vehicle');
  assert.equal(s.independentVehicleToOEProof, 0, 'the vehicle sample contains no vehicle-specific OE proof');
  assert.equal(s.noNetworkOrGlavistaUsed, true);
  assert.equal(s.vehicleFitmentFalsePositiveRateMeasured, false);
  assert.ok(result.rates.candidateCoveragePct >= 0 && result.rates.candidateCoveragePct <= 100);
});
