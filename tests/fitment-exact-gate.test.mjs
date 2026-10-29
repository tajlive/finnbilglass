import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateExactGate,
  evaluateObservationGate
} from '../src/fitment-v1/policy/gate.ts';

const valid = {
  vehicleIdentityResolved: true,
  applicationEdgeAuthoritative: true,
  oeGlassEdgeAuthoritativeOrIndependent: true,
  materialConflicts: [],
  candidateCount: 1,
};

test('P0.1: one proven candidate passes', () => {
  const r = evaluateExactGate(valid);
  assert.equal(r.passed, true);
  assert.equal(r.authoritativeDataExact, true);
});

test('P0.1: zero candidates fail', () => {
  const r = evaluateExactGate({...valid, candidateCount: 0});
  assert.equal(r.passed, false);
  assert.equal(r.authoritativeDataExact, false);
});

test('P0.1: multiple candidates fail', () => {
  for (const n of [2, 3, 50]) {
    const r = evaluateExactGate({...valid, candidateCount: n});
    assert.equal(r.passed, false);
    assert.equal(r.authoritativeDataExact, false);
    assert.ok(r.reasonCodes.includes('CANDIDATE_COUNT_NOT_ONE'));
  }
});

test('P0.1: invalid counts fail', () => {
  for (const n of [-1, 0.5, Number.NaN, Infinity]) {
    const r = evaluateExactGate({...valid, candidateCount: n});
    assert.equal(r.passed, false);
    assert.equal(r.authoritativeDataExact, false);
  }
});

test('P0.1: unresolved conflict fails', () => {
  const r = evaluateExactGate({
    ...valid,
    materialConflicts: ['camera variant unresolved'],
  });
  assert.equal(r.passed, false);
  assert.equal(r.authoritativeDataExact, false);
});

test('P0.1: missing evidence fails', () => {
  for (const key of [
    'vehicleIdentityResolved',
    'applicationEdgeAuthoritative',
    'oeGlassEdgeAuthoritativeOrIndependent',
  ]) {
    const r = evaluateExactGate({...valid, [key]: false});
    assert.equal(r.passed, false);
    assert.equal(r.authoritativeDataExact, false);
  }
});

test('P0.1: unreliable observation fails', () => {
  const r = evaluateObservationGate({
    narrowedByEvidence: true,
    observations: [{reliable: false}],
    remainingCandidates: ['A'],
  });
  assert.equal(r.passed, false);
});

test('P0.1: ambiguous observation fails', () => {
  const r = evaluateObservationGate({
    narrowedByEvidence: true,
    observations: [{reliable: true}],
    remainingCandidates: ['A', 'B'],
  });
  assert.equal(r.passed, false);
});

test('P0.1: reliable unique observation passes', () => {
  const r = evaluateObservationGate({
    narrowedByEvidence: true,
    observations: [{reliable: true}],
    remainingCandidates: ['A'],
  });
  assert.equal(r.passed, true);
});
