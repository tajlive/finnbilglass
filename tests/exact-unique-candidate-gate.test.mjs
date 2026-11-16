import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExactGate, evaluateObservationGate } from '../src/fitment-v1/policy/gate.js';
const authoritative={
  vehicleIdentityResolved:true,applicationEdgeAuthoritative:true,
  oeGlassEdgeAuthoritativeOrIndependent:true,materialConflicts:[],
};
test('authoritative EXACT fails closed for zero and multiple glass candidates',()=>{
  for(const candidateCount of [0,2,3,999,-1,NaN]){
    const r=evaluateExactGate({...authoritative,candidateCount});
    assert.equal(r.passed,false,String(candidateCount));
    assert.equal(r.authoritativeDataExact,false,String(candidateCount));
    assert.ok(r.reasonCodes.includes('EXACT_REQUIRES_UNIQUE_CANDIDATE'));
  }
});
test('unique glass is necessary but cannot replace independent application or OE proof',()=>{
  for(const input of [
    {...authoritative,vehicleIdentityResolved:false},
    {...authoritative,applicationEdgeAuthoritative:false},
    {...authoritative,oeGlassEdgeAuthoritativeOrIndependent:false},
    {...authoritative,materialConflicts:['camera bracket mismatch']},
  ]){
    const r=evaluateExactGate({...input,candidateCount:1});
    assert.equal(r.passed,false);
    assert.equal(r.authoritativeDataExact,false);
  }
});
test('genuine authoritative single candidate still passes the fully evidenced gate',()=>{
  const r=evaluateExactGate({...authoritative,candidateCount:1});
  assert.equal(r.passed,true);
  assert.equal(r.authoritativeDataExact,true);
  assert.equal(r.checks.E_exactlyOneSelectedGlass,true);
});
test('customer observation with unreliable or ambiguous evidence cannot auto-EXACT',()=>{
  for(const input of [
    {narrowedByEvidence:true,observations:[{reliable:false}],remainingCandidates:['A']},
    {narrowedByEvidence:true,observations:[{reliable:true}],remainingCandidates:['A','B']},
    {narrowedByEvidence:false,observations:[{reliable:true}],remainingCandidates:['A']},
    {narrowedByEvidence:true,observations:[],remainingCandidates:['A']},
  ]){
    const r=evaluateObservationGate(input);
    assert.equal(r.passed,false);
    assert.equal(r.authoritativeDataExact,false);
  }
});
