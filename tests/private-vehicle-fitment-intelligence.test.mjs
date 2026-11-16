import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const CLI=new URL('../scripts/run-private-corpus-intelligence.mjs',import.meta.url).pathname;
const KEY='synthetic-test-secret-with-at-least-32-bytes-no-real-data';
function synthetic(dir,count=36){
  const names=[
    ['VW','GOLF',2015],['VW','ID.4',2022],
    ['VW','TRANSPORTER',2015],['MAZDA','CX-5',2017],
    ['TESLA','MODEL Y',2023],['TOYOTA','RAV4',2018],
    ['FIAT','500 ELECTRIC',2022],['POLESTAR','2',2023],
    ['ACME','MOON CAR',2018],
  ];
  const records=[];
  for(let i=0;i<count;i++){
    const [merke,modell,aar]=names[i%names.length];
    records.push({regnr:'ZZ'+String(i).padStart(5,'0'),
      vin:'EXPERIMENTALVIN'+String(i).padStart(6,'0'),merke,modell,aar});
  }
  const path=join(dir,'vehicles.ndjson');
  writeFileSync(path,records.map(x=>JSON.stringify(x)).join('\n')+'\n');
  return {path,records};
}
test('full pipeline analyses every vehicle with actual SQL matcher and keeps all statuses unverified',()=>{
  const dir=mkdtempSync(join(tmpdir(),'fbg-full-corpus-'));
  try{
    const {path,records}=synthetic(dir,36);
    const output=join(dir,'private-results');
    const r=spawnSync(process.execPath,[CLI,'--input',path,'--output-dir',output],{
      cwd:new URL('..',import.meta.url).pathname,encoding:'utf8',
      env:{...process.env,FBG_CORPUS_HMAC_KEY:KEY},
      maxBuffer:2*1024*1024,
    });
    assert.equal(r.status,0,r.stderr);
    const report=JSON.parse(readFileSync(join(output,'fitment-aggregates.json'),'utf8'));
    const queue=JSON.parse(readFileSync(join(output,'priority-evidence-queue.json'),'utf8'));
    const audit=JSON.parse(readFileSync(join(output,'audit-aggregates.json'),'utf8'));
    const sample=JSON.parse(readFileSync(join(output,'frozen-first30.json'),'utf8'));
    assert.equal(audit.metrics.uniqueVehicles,36);
    assert.equal(report.totals.eligibleVehicles,36);
    assert.equal(queue.cases.length,36);
    assert.equal(sample.cases.length,30);
    assert.equal(report.cohort.holdout,10);
    assert.equal(report.cohort.development,20);
    assert.equal(report.totals.withCandidates+report.totals.withoutCandidates,36);
    assert.ok(report.totals.withCandidates>0,'actual 6-part price list should produce candidates');
    assert.ok(report.totals.withoutCandidates>0,'unsupported make should remain unmatched');
    assert.ok(report.catalogue.indexedCandidateRows>3000);
    assert.match(report.catalogue.sha256,/^[a-f0-9]{64}$/);
    assert.equal(report.catalogue.liveReuseLicenceVerified,false);
    assert.equal(report.safety.automaticExactActivated,false);
    assert.equal(report.safety.physicalFitmentPrecisionMeasured,false);
    assert.equal(report.totals.automaticExact,0);
    assert.equal(report.totals.independentOEProof,0);
    assert.ok(queue.cases.every(c=>c.evidenceStatus==='NOT_VERIFIED'&&c.autoExact===false));
    assert.ok(queue.cases.every(c=>c.decision==='NEEDS_INDEPENDENT_HUMAN_EVIDENCE'));
    assert.ok(queue.cases.every(c=>c.candidateCount>=0&&c.nextAction));
    assert.deepEqual(queue.cases.map(x=>x.priorityScore),[...queue.cases].map(x=>x.priorityScore).sort((a,b)=>b-a));
    const noHitTotal=Object.values(report.noCandidateReasons).reduce((a,b)=>a+b,0);
    assert.equal(noHitTotal,report.totals.withoutCandidates);
    const txt=readFileSync(join(output,'priority-evidence-queue.json'),'utf8');
    const rep=readFileSync(join(output,'fitment-aggregates.json'),'utf8');
    for(const row of records){
      assert.ok(!txt.includes(row.regnr)&&!rep.includes(row.regnr));
      assert.ok(!txt.includes(row.vin)&&!rep.includes(row.vin));
    }
    assert.equal(statSync(output).mode&0o077,0);
    assert.equal(statSync(join(output,'priority-evidence-queue.json')).mode&0o777,0o600);
  } finally{rmSync(dir,{recursive:true,force:true});}
});

test('full pipeline rejects non-private destination, never starts with missing secret',()=>{
  const dir=mkdtempSync(join(tmpdir(),'fbg-corpus-reject-'));
  try{
    const {path}=synthetic(dir,3);
    const r=spawnSync(process.execPath,[CLI,'--input',path,'--output-dir',dir],{
      encoding:'utf8',env:{...process.env,FBG_CORPUS_HMAC_KEY:'bad'},
    });
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/STRONG_HMAC_KEY_REQUIRED/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
