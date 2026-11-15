import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalogueComment } from '../src/fitment-v1/normalization/catalogue-feature-comment.js';
import { buildClassDCandidates, matchClassDCandidates } from '../src/fitment-v1/catalogue-candidates.js';

const row = (sku,name,comment='',code='5689AGNV') => ({varenr:sku,varenavn:name,kommentar:comment,eurokode:code});

test('Explicit negative camera and rain sensor are false, not positive', () => {
  const parsed=parseCatalogueComment('UTEN KAMERA; IKKE SENSOR; AKUSTISK');
  assert.equal(parsed.states.camera,false);
  assert.equal(parsed.states.rainSensor,false);
  assert.equal(parsed.states.acoustic,true);
  assert.equal(parsed.states.heated,null);
});

test('Keyword presence does not mean the vehicle has an installed option', () => {
  const items=buildClassDCandidates([
    row('without','MITSUBISHI ASX FRONTRUTE 10-','UTEN KAMERA OG IKKE SENSOR'),
    row('with','MITSUBISHI ASX FRONTRUTE 10-','KAMERA SENSOR'),
  ]);
  assert.equal(items[0].featureEvidence?.states.camera,false);
  assert.equal(items[0].featureEvidence?.states.rainSensor,false);
  assert.ok(!items[0].features.includes('camera'));
  assert.ok(!items[0].features.includes('rainSensor'));
  assert.equal(items[1].featureEvidence?.states.camera,true);
  assert.equal(items[1].featureEvidence?.states.rainSensor,true);
  assert.ok(items.every(i=>i.klassifisering==='CLASS_D_CATALOGUE_CANDIDATE'));
});

test('Conflicting catalogue comments remain unknown rather than being resolved by heuristics', () => {
  const p=parseCatalogueComment('KAMERA, UTEN KAMERA, SENSOR');
  assert.equal(p.states.camera,null);
  assert.ok(p.warnings.includes('CONTRADICTORY_FEATURE:camera'));
  assert.equal(p.states.rainSensor,true);
});

test('Missing comment returns explicit UNKNOWN tri-state', () => {
  const p=parseCatalogueComment(null);
  assert.equal(p.states.camera,null);
  assert.equal(p.states.rainSensor,null);
  assert.equal(p.states.heated,null);
});

test('Confirmed CX-5 generation eliminates contradictory labelled candidates only', () => {
  const c=buildClassDCandidates([
    row('first','MAZDA CX-5 I FRONTRUTE 12-'),
    row('second','MAZDA CX-5 II FRONTRUTE 17-'),
    row('unknown','MAZDA CX-5 FRONTRUTE 17-'),
  ]);
  assert.deepEqual(matchClassDCandidates(c,'MAZDA','CX-5',2017).map(x=>x.varenr),['first','second','unknown']);
  assert.deepEqual(matchClassDCandidates(c,'MAZDA','CX-5',2017,{confirmedGeneration:'II'}).map(x=>x.varenr),['second','unknown']);
  assert.equal(c[2].generationHint,null);
});

test('Transporter 2015 T5/T6 overlap remains ambiguous without confirmed generation', () => {
  const c=buildClassDCandidates([
    row('T5','VW TRANSPORTER T5 FRONTRUTE 03-','', '8579AGSGYAVZ1B'),
    row('T6','VW TRANSPORTER T6 FRONTRUTE 15-','', '8579AGNGYAV'),
  ]);
  assert.equal(matchClassDCandidates(c,'VW','TRANSPORTER',2015).length,2);
  assert.deepEqual(matchClassDCandidates(c,'VW','TRANSPORTER',2015,{confirmedGeneration:'T6'}).map(x=>x.varenr),['T6']);
});

test('Known generation excludes older Golf variant while unknown generation never proves fitment', () => {
  const c=buildClassDCandidates([
    row('GolfVI','VW GOLF VI FRONTRUTE 08-'),
    row('GolfVII','VW GOLF VII FRONTRUTE 12-'),
    row('GolfUnknown','VW GOLF FRONTRUTE 12-'),
  ]);
  assert.deepEqual(matchClassDCandidates(c,'VW','GOLF',2015,{confirmedGeneration:'Golf VII (Typ 5G)'}).map(x=>x.varenr),
    ['GolfVII','GolfUnknown']);
  assert.ok(c.every(x=>x.klassifisering==='CLASS_D_CATALOGUE_CANDIDATE'));
});
