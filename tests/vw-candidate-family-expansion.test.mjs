import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClassDCandidates, matchClassDCandidates } from '../src/fitment-v1/catalogue-candidates.js';

// Synthetic names mirroring patterns in the already-checked-in own SQL files.
// No external catalogue import or vehicle-specific truth is implied.
const rows=[
  {varenr:'VW-ID4',varenavn:'VW ID.4 5D SUV 20- FRONTRUTE',eurokode:'8658AGAC'},
  {varenr:'VW-ID5-REAR',varenavn:'VW ID.5 5D CROSSOVER 21- BAKRUTE',eurokode:'8658BGSC'},
  {varenr:'VW-ID3',varenavn:'VW ID.3 5D HBK 20- FRONTRUTE',eurokode:'8652AGAC'},
  {varenr:'VW-CADDY',varenavn:'VW CADDY 5D 15- FRONTRUTE',eurokode:'8585AGNV'},
  {varenr:'VW-CADDY-SIDE',varenavn:'VW CADDY 5D 15- SIDERUTE',eurokode:'8585LGNV'},
  {varenr:'VW-TOURAN',varenavn:'VW TOURAN 5D 15- FRONTRUTE',eurokode:'8576AGNV'},
  {varenr:'VW-GOLF',varenavn:'VW GOLF VII 13- FRONTRUTE',eurokode:'8573AGNV'},
  {varenr:'VW-SPORTSVAN',varenavn:'VW GOLF SPORTSVAN VII 13- FRONTRUTE',eurokode:'8574AGNV'},
  {varenr:'VW-PLUS',varenavn:'VW GOLF PLUS 05- FRONTRUTE',eurokode:'8572AGNV'},
  {varenr:'VW-EGOLF',varenavn:'VW E-GOLF VII 14- FRONTRUTE',eurokode:'8571AGNV'},
  {varenr:'VW-BUZZ',varenavn:'VW ID BUZZ VAN 22- FRONTRUTE',eurokode:'8666AGAC'},
];
const index=buildClassDCandidates(rows);
const skus=(make,model,year)=>matchClassDCandidates(index,make,model,year).map(c=>c.varenr);

test('ID.4 (including GTX) does not inherit ID.5 rear glass',()=>{
  assert.deepEqual(skus('VW','ID.4',2022),['VW-ID4']);
  assert.deepEqual(skus('Volkswagen','ID.4 GTX',2022),['VW-ID4']);
  assert.deepEqual(skus('VW','ID.5',2022),[]);
});

test('ID.3 and ID Buzz candidate families remain distinct',()=>{
  assert.deepEqual(skus('VW','ID.3',2021),['VW-ID3']);
  assert.deepEqual(skus('VW','ID. Buzz',2023),['VW-BUZZ']);
  assert.deepEqual(skus('VW','ID.4',2018),[]);
});

test('Caddy Maxi is in the Caddy candidate family, but side glass is rejected',()=>{
  assert.deepEqual(skus('VW','Caddy Maxi',2018),['VW-CADDY']);
  assert.deepEqual(skus('VW','Caddy',2012),[]);
});

test('Touran matches only a documented model and year candidate',()=>{
  assert.deepEqual(skus('Volkswagen','Touran',2016),['VW-TOURAN']);
  assert.deepEqual(skus('VW','Touran',2014),[]);
});

test('Golf, Golf Plus, Sportsvan and e-Golf do not share candidate classes',()=>{
  assert.deepEqual(skus('VW','Golf VII',2015),['VW-GOLF']);
  assert.deepEqual(skus('VW','Golf Sportsvan',2015),['VW-SPORTSVAN']);
  assert.deepEqual(skus('VW','Golf Plus',2008),['VW-PLUS']);
  assert.deepEqual(skus('VW','e-Golf VII',2016),['VW-EGOLF']);
});

test('Without product records, unsupported families remain no-candidate, never guessed',()=>{
  assert.deepEqual(skus('VW','ID.7',2025),[]);
  assert.deepEqual(skus('VW','Crafter',2017),[]);
  assert.deepEqual(skus('VW','Andre',2024),[]);
});

test('Every discovered candidate remains unverified internal Class D catalogue material',()=>{
  assert.ok(index.every(x=>x.klassifisering==='CLASS_D_CATALOGUE_CANDIDATE'));
  assert.ok(index.every(x=>x.source==='GT_AUTO_PRISLISTE'));
});
