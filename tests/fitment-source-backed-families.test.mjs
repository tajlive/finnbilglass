import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { canonicalVehicleName } from '../src/fitment-v1/normalization/vehicle-model-name.js';
import { buildClassDCandidates, matchClassDCandidates, isDistinctBodyVariant } from '../src/fitment-v1/catalogue-candidates.js';
import { parseEurocodePosition } from '../src/fitment-v1/normalization/eurocode-position.js';

const root=fileURLToPath(new URL('..',import.meta.url));
test('shared normalizer handles duplicate make and preserves physically distinct derivatives',()=>{
  const input=[
    ['MITSUBISHI','MITSUBISHI MITSUBISHI OUTLANDER','MITSUBISHI','OUTLANDER'],
    ['TOYOTA','TOYOTA TOYOTA RAV4','TOYOTA','RAV4'],
    ['VOLKSWAGEN','GOLF SPORTSVAN','VW','GOLF SPORTSVAN'],
    ['VW','E-GOLF','VW','E-GOLF'],
    ['FIAT','500 ELECTRIC','FIAT','500 ELECTRIC'],
    ['VOLVO','XC40 RECHARGE','VOLVO','XC40 RECHARGE'],
    ['VOLVO','C40 RECHARGE','VOLVO','C40 RECHARGE'],
    ['FORD','FOCUS C-MAX','FORD','FOCUS C-MAX'],
  ];
  for(const [make,model,expectedMake,expectedModel] of input){
    const n=canonicalVehicleName(make,model);
    assert.equal(n.make,expectedMake,make+' '+model);
    assert.equal(n.model,expectedModel,make+' '+model);
  }
});

test('all twelve new families have actual numeric-A windscreen candidates in six checked-in SQL snapshots',()=>{
  const db=new DatabaseSync(':memory:');
  let rows;
  try{
    db.exec(readFileSync(join(root,'db/schema-katalog.sql'),'utf8'));
    const files=readdirSync(join(root,'db/katalog')).filter(x=>/^prisliste_insert_\d\d\.sql$/.test(x)).sort();
    assert.equal(files.length,6);
    for(const f of files)db.exec(readFileSync(join(root,'db/katalog',f),'utf8'));
    rows=db.prepare("SELECT varenr,varenavn,kommentar,eurokode FROM glass_prisliste WHERE rad_type='glass'").all();
  }finally{db.close();}
  const index=buildClassDCandidates(rows);
  const cases=[
    ['SKODA','OCTAVIA',2015],['SKODA','SUPERB',2015],
    ['MITSUBISHI','MITSUBISHI OUTLANDER',2013],
    ['VOLVO','XC40',2020],['VOLVO','V70',1999],['VOLVO','C40 RECHARGE',2022],
    ['FORD','FOCUS',2012],['FORD','KUGA',2013],['FORD','MONDEO',2010],
    ['TOYOTA','TOYOTA AVENSIS',2010],['TOYOTA','AURIS',2013],['TOYOTA','YARIS',2013],
  ];
  for(const [make,model,year] of cases){
    const candidates=matchClassDCandidates(index,make,model,year);
    assert.ok(candidates.length>0,'no source-backed front candidate: '+make+' '+model+' '+year);
    assert.ok(candidates.every(c=>parseEurocodePosition(c.eurokode).position==='WINDSCREEN'),
      'non-front candidate leaked: '+make+' '+model+' '+year);
    assert.ok(candidates.every(c=>c.klassifisering==='CLASS_D_CATALOGUE_CANDIDATE'),
      'catalogue result is not independent fitment evidence');
  }
});

test('dangerous mixed catalogue models, body variants and unclear Eurocodes never cross-match',()=>{
  const r=(varenr,varenavn,eurokode)=>({varenr,varenavn,kommentar:'',eurokode});
  const rows=[
    r('oldMix','VOLVO V40+XC40 5D SUV 12- WS','8842ASMHL'),
    r('xc40','VOLVO XC40 5D SUV 17-','8847AGACHMVZ1M'),
    r('v70mix','VOLVO S80 / V70 06-11','8836ACCBLMVZ1R'),
    r('v70','VOLVO V70 5D STVOGN 97-00','8827AGNBL'),
    r('cmax','FORD FOCUS C-MAX 03-','3565ABSHMVW1P'),
    r('focus','FORD FOCUS 11- FRONTRUTE','3578AGAVW'),
    r('focusRear','FORD FOCUS 11- BAKRUTE','3578BGSV'),
    r('focusUnknown','FORD FOCUS 11- NO VERIFIED POSITION','OEMUNKNOWN'),
    r('avensisVerso','TOYOTA AVENSIS VERSO 02-','8333ASMVT'),
    r('avensis','TOYOTA AVENSIS 09-','8379AGNV'),
    r('yarisVerso','TOYOTA YARIS VERSO 03-','8317AGSGY1P'),
    r('yarisCross','TOYOTA YARIS CROSS 21-','8437AGNV'),
    r('yaris','TOYOTA YARIS 20-','8438AGACMUZ'),
    r('octavia','SKODA OCTAVIA 13-','7816AGSV'),
    r('superb','SKODA SUPERB 15-','7819AGNV'),
    r('c40','VOLVO C40 RECHARGE 21- WS','8850AGACMVZ1M'),
  ];
  const ix=buildClassDCandidates(rows);
  const codes=(make,model,year)=>matchClassDCandidates(ix,make,model,year).map(x=>x.varenr);
  assert.deepEqual(codes('VOLVO','XC40',2020),['xc40']);
  assert.deepEqual(codes('VOLVO','V70',1999),['v70']);
  assert.deepEqual(codes('VOLVO','C40',2022),['c40']);
  assert.deepEqual(codes('FORD','FOCUS',2012),['focus']);
  assert.deepEqual(codes('FORD','FOCUS C-MAX',2012),[]);
  assert.deepEqual(codes('TOYOTA','AVENSIS',2010),['avensis']);
  assert.deepEqual(codes('TOYOTA','AVENSIS VERSO',2010),[]);
  assert.deepEqual(codes('TOYOTA','YARIS',2022),['yaris']);
  assert.deepEqual(codes('TOYOTA','YARIS CROSS',2022),[]);
  assert.deepEqual(codes('TOYOTA','YARIS VERSO',2022),[]);
  assert.deepEqual(codes('SKODA','OCTAVIA',2017),['octavia']);
  assert.deepEqual(codes('SKODA','SUPERB',2017),['superb']);
  assert.equal(isDistinctBodyVariant('FORD','FOCUS','FOCUS C-MAX'),true);
  assert.equal(isDistinctBodyVariant('VOLVO','XC40','V40+XC40 12- WS'),true);
  assert.ok(ix.every(x=>x.klassifisering==='CLASS_D_CATALOGUE_CANDIDATE'));
});
