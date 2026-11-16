import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI=new URL('../scripts/private-vehicle-corpus-audit.mjs',import.meta.url).pathname;
const KEY='synthetic-test-only-hmac-key-at-least-32-bytes';
function run(dir,args=[],env={}){
  return spawnSync(process.execPath,[CLI,...args],{encoding:'utf8',env:{
    ...process.env,FBG_CORPUS_HMAC_KEY:KEY,...env
  },cwd:dir});
}
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'fbg-private-corpus-'));
  const rows=[];
  for(let i=0;i<36;i++){
    const make=i%4===0?'VW':i%4===1?'TESLA':i%4===2?'MAZDA':'TOYOTA';
    const model=make==='VW'?'TRANSPORTER':make==='TESLA'?'MODEL Y':make==='MAZDA'?'CX-5':'COROLLA';
    const aar=make==='VW'?2015:make==='MAZDA'?2017:make==='TESLA'?2023:2019;
    rows.push({regnr:'ZZ'+String(i).padStart(5,'0'),vin:'TESTVIN'+String(i).padStart(10,'0'),
      merke:make,modell:model,aar});
  }
  rows.push({...rows[0]}); // one identical duplicate
  writeFileSync(join(dir,'vehicles.ndjson'),rows.map(x=>JSON.stringify(x)).join('\n')+'\nBROKEN-JSON\n');
  return {dir,rows};
}

test('private audit pseudonymizes 30 candidates and holds 10 out; exact=0',()=>{
  const {dir,rows}=fixture();
  try{
    const report=join(dir,'report.json'),sample=join(dir,'selected.json');
    const r=run(dir,['--input',join(dir,'vehicles.ndjson'),'--report',report,'--sample',sample]);
    assert.equal(r.status,0,r.stderr);
    const output=readFileSync(report,'utf8');
    const sampleText=readFileSync(sample,'utf8');
    for(const row of rows){
      assert.ok(!output.includes(row.regnr)&&!sampleText.includes(row.regnr));
      assert.ok(!output.includes(row.vin)&&!sampleText.includes(row.vin));
    }
    assert.ok(!output.includes(KEY));
    assert.ok(!sampleText.includes(KEY));
    const d=JSON.parse(output),s=JSON.parse(sampleText);
    assert.equal(d.metrics.uniqueVehicles,36);
    assert.equal(d.metrics.duplicateVehicleIds,1);
    assert.equal(d.metrics.invalidJson,1);
    assert.equal(d.selection.selected,30);
    assert.equal(d.selection.holdout,10);
    assert.equal(d.selection.development,20);
    assert.equal(d.selection.verifiedExact,0);
    assert.ok(s.cases.every(x=>x.evidenceStatus==='NOT_VERIFIED'&&x.confirmedGlass===null));
    assert.equal(new Set(s.cases.map(x=>x.caseId)).size,30);
    assert.ok(s.cases.every(x=>!('regnr' in x||'vin' in x)));
    assert.equal(statSync(report).mode & 0o777,0o600);
    assert.equal(statSync(sample).mode & 0o777,0o600);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('audit does not run without strong secret HMAC key',()=>{
  const {dir}=fixture();
  try {
    const r=run(dir,['--input',join(dir,'vehicles.ndjson')],{FBG_CORPUS_HMAC_KEY:'bad'});
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/STRONG_PRIVATE_HMAC_KEY_REQUIRED/);
    assert.doesNotMatch(r.stdout,/ZZ\d{5}/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('audit refuses overwriting private output and preserves earlier report',()=>{
  const {dir}=fixture();
  try{
    const output=join(dir,'report.json');
    const args=['--input',join(dir,'vehicles.ndjson'),'--report',output];
    assert.equal(run(dir,args).status,0);
    const before=readFileSync(output,'utf8');
    const twice=run(dir,args);
    assert.notEqual(twice.status,0);
    assert.equal(readFileSync(output,'utf8'),before);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('audit does not invent golden cases when all input rows are unusable',()=>{
  const dir=mkdtempSync(join(tmpdir(),'fbg-private-empty-'));
  try {
    const input=join(dir,'invalid.ndjson');
    writeFileSync(input,JSON.stringify({regnr:'ZZ12345'})+'\n');
    const r=run(dir,['--input',input]);
    assert.equal(r.status,0,r.stderr);
    const line=r.stdout.split('\n').find(x=>x.startsWith('FBG_PRIVATE_CORPUS_REPORT='));
    const report=JSON.parse(line.slice('FBG_PRIVATE_CORPUS_REPORT='.length));
    assert.equal(report.metrics.uniqueVehicles,0);
    assert.equal(report.selection.selected,0);
    assert.equal(report.selection.verifiedExact,0);
    assert.equal(report.metrics.missingMakeModelYear,1);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
