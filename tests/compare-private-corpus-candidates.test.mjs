import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI=new URL('../scripts/compare-private-corpus-candidates.mjs',import.meta.url).pathname;
const caseFor=(id,count,extra={})=>({
  caseId:'v_'+id.repeat(32),sourceFactsFingerprint:id.repeat(32),make:'FORD',model:'FOCUS',year:2013,
  candidateCount:count,evidenceStatus:'NOT_VERIFIED',
  confirmedGlass:null,autoExact:false,...extra
});
const save=(path,cases,catalogueSha256='a'.repeat(64))=>writeFileSync(path,JSON.stringify({
  purpose:'FULL_FLEET_FITMENT_EVIDENCE_GAPS',
  catalogueSha256,cases
}));
const exec=(a,b)=>spawnSync(process.execPath,[CLI,'--before',a,'--after',b],{encoding:'utf8'});

test('same-cohort diff reports only aggregate gains, losses, and ambiguity',()=>{
  const dir=mkdtempSync(join(tmpdir(),'fbg-private-diff-'));
  try{
    const old=join(dir,'old.json'),now=join(dir,'now.json');
    save(old,[caseFor('a',0),caseFor('b',2),caseFor('c',1)]);
    save(now,[caseFor('c',2),caseFor('b',0),caseFor('a',2,{modelNameNormalized:true,model:'PRIVATEVINIDENTIFIERXYZ'})]);
    const r=exec(old,now);
    assert.equal(r.status,0,r.stderr);
    const line=r.stdout.trim();
    assert.match(line,/^FBG_CANDIDATE_COMPARISON=/);
    const summary=JSON.parse(line.slice('FBG_CANDIDATE_COMPARISON='.length));
    assert.equal(summary.samePseudonymousCohort,true);
    assert.equal(summary.catalogueUnchanged,true);
    assert.equal(summary.sourceVehicleFactsUnchanged,true);
    assert.equal(summary.beforeWithCandidates,2);
    assert.equal(summary.afterWithCandidates,2);
    assert.equal(summary.candidateGain,1);
    assert.equal(summary.candidateLoss,1);
    assert.equal(summary.newlyMultipleCandidates,2);
    assert.equal(summary.normalizedVehicleModelNames,1);
    assert.equal(summary.automaticExact,0);
    assert.ok(!line.includes('v_'+('a'.repeat(32))));
    assert.ok(!line.includes('PRIVATEVINIDENTIFIERXYZ'), 'never echo arbitrary private model fields');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('candidate diff rejects missing case and refuses an auto-EXACT case',()=>{
  const dir=mkdtempSync(join(tmpdir(),'fbg-private-reject-'));
  try{
    const a=join(dir,'a.json'),b=join(dir,'b.json');
    save(a,[caseFor('a',0),caseFor('b',1)]);
    save(b,[caseFor('a',0)]);
    const changed=exec(a,b);
    assert.notEqual(changed.status,0);
    assert.match(changed.stderr,/COHORT_CHANGED_COMPARE_NOT_VALID/);
    save(b,[caseFor('a',1),caseFor('b',2,{autoExact:true})]);
    const unsafe=exec(a,b);
    assert.notEqual(unsafe.status,0);
    assert.match(unsafe.stderr,/CORPUS_EVIDENCE_GATE_VIOLATED/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});


test('candidate comparison refuses changed source facts or a different catalogue',()=>{
  const dir=mkdtempSync(join(tmpdir(),'fbg-private-integrity-'));
  try{
    const a=join(dir,'a.json'),b=join(dir,'b.json');
    save(a,[caseFor('a',0),caseFor('b',1)]);
    save(b,[caseFor('a',2,{sourceFactsFingerprint:'f'.repeat(32)}),caseFor('b',1)]);
    assert.match(exec(a,b).stderr,/SOURCE_VEHICLE_FACTS_CHANGED_COMPARE_NOT_VALID/);
    save(b,[caseFor('a',2,{year:2014}),caseFor('b',1)]);
    assert.match(exec(a,b).stderr,/SOURCE_VEHICLE_FACTS_CHANGED_COMPARE_NOT_VALID/);
    save(b,[caseFor('a',2),caseFor('b',1)],'b'.repeat(64));
    assert.match(exec(a,b).stderr,/CATALOGUE_CHANGED_COMPARE_NOT_VALID/);
    save(b,[caseFor('a',2,{sourceFactsFingerprint:null}),caseFor('b',1)]);
    assert.match(exec(a,b).stderr,/SOURCE_FACTS_FINGERPRINT_REQUIRED_REGENERATE_AUDIT/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
