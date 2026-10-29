import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClassDCandidates, matchClassDCandidates } from '../src/fitment-v1/catalogue-candidates.ts';
import { dekodeEurokode } from '../src/eurokode-dekoder.ts';
import { basisAttributterFraEurokode, berikAttributterFraVaretekst } from '../src/vin-resolver.ts';

const row = (kommentar) => ({ varenr: '3345GNCM', eurokode: '5382AGSACMZ1B', varenavn: 'MERCEDES VITO W447 14-19 FR', kommentar });

test('LDW er feltskiftevarsling, ikke bevis for kamerafeste eller HUD', () => {
  const [candidate] = buildClassDCandidates([row('LDW ANTENNE')]);
  assert.ok(candidate.features.includes('ldw'));
  assert.ok(!candidate.features.includes('camera'));
  assert.ok(!candidate.features.includes('hud'));
});

test('HUD, kamera og LDW beholdes som tre ulike egenskaper', () => {
  const [candidate] = buildClassDCandidates([row('HUD KAMERA LDW')]);
  assert.ok(candidate.features.includes('hud'));
  assert.ok(candidate.features.includes('camera'));
  assert.ok(candidate.features.includes('ldw'));
});

test('oppvarmet eurokode blir ikke HUD i resolver', () => {
  const dek = dekodeEurokode('1234AAH');
  assert.ok(dek.egenskaper.includes('oppvarmet'));
  assert.equal(basisAttributterFraEurokode(dek).hud, null);
  assert.equal(basisAttributterFraEurokode(dek).oppvarmet, true);
  assert.equal(basisAttributterFraEurokode(dekodeEurokode('7H0877051')).sensor, null);
});

test('varetekst skiller HUD og LDW uten å gjette nei fra fravær', () => {
  const a = basisAttributterFraEurokode(dekodeEurokode('1234AAH'));
  berikAttributterFraVaretekst(a, 'VITO W447 FR LDW');
  assert.equal(a.ldw, true);
  assert.equal(a.hud, null);
  const b = basisAttributterFraEurokode(dekodeEurokode('1234AGN'));
  berikAttributterFraVaretekst(b, 'VITO W447 FR HUD UTEN LDW');
  assert.equal(b.hud, true);
  assert.equal(b.ldw, false);
  const c = basisAttributterFraEurokode(dekodeEurokode('1234AGN'));
  berikAttributterFraVaretekst(c, 'VITO W447 FR');
  assert.equal(c.ldw, null);
});

test('DP77335: 2015/W447 utelukker 2020+ ruter, men lar to 2014-19-varianter stå', () => {
  const names = [
    ['3345GNAM', 'MERCEDES V-CLASS W447 14-19 FR +ANT+SENSOR+INNK+GN'],
    ['3345GNAM2', 'MERCEDES V-CLASS W447 20- FR +ANT+SENSOR+INNK+GN'],
    ['3345GNCM', 'MERCEDES V-CLASS W447 14-19 FR +SENS+LDW+ANT+INNK+GN'],
    ['3345GNCM2', 'MERCEDES V-CLASS W447 20-23 FR +SENS+LDW+ANT+INNK+GN'],
    ['3345GNCM3', 'MERCEDES V-CLASS W447 24- FR +SENS+LDW+ANT+INNK+GN'],
  ];
  const index = buildClassDCandidates(names.map(([varenr, varenavn]) => ({ varenr, varenavn })));
  const hits = matchClassDCandidates(index, 'MERCEDES', 'VITO W447', 2015);
  assert.deepEqual(hits.map(x => x.varenr).sort(), ['3345GNAM', '3345GNCM']);
  assert.deepEqual(matchClassDCandidates(index, 'MERCEDES', 'CLA 180', 2015), []);
  assert.deepEqual(matchClassDCandidates(index, 'MERCEDES', 'VITO W447', null), []);
  assert.deepEqual(matchClassDCandidates(index, 'MERCEDES', 'VITO W447', 2021).map(x => x.varenr).sort(), ['3345GNAM2', '3345GNCM2']);
});

test('GLA er et eget modellord og kan ikke leses fra GLASS', () => {
  const index = buildClassDCandidates([
    { varenr: 'X1', varenavn: 'MERCEDES GLASS A-CLASS 14-19 FRONTRUTE' },
    { varenr: 'X2', varenavn: 'MERCEDES GLA 14-19 FRONTRUTE' },
  ]);
  assert.deepEqual(matchClassDCandidates(index, 'MERCEDES', 'A-CLASS', 2015).map(x => x.varenr), ['X1']);
  assert.deepEqual(matchClassDCandidates(index, 'MERCEDES', 'GLA', 2015).map(x => x.varenr), ['X2']);
});

test('katalogkandidater dekker ASX og Fiat 500, men holder modellfamiliene adskilt', () => {
  const index = buildClassDCandidates([
    { varenr: '3031GYM', varenavn: 'MITSUBISHI ASX 5D SUV 10-' },
    { varenr: '2833GN', varenavn: 'FIAT 500 3D CC 07-' },
    { varenr: '2525GYM', varenavn: 'VW TRANSP+CARAVELLE 2003-' },
  ]);
  assert.deepEqual(matchClassDCandidates(index, 'MITSUBISHI', 'ASX', 2011).map(x => x.varenr), ['3031GYM']);
  assert.deepEqual(matchClassDCandidates(index, 'FIAT', '500 ELECTRIC', 2014).map(x => x.varenr), ['2833GN']);
  assert.deepEqual(matchClassDCandidates(index, 'MITSUBISHI', 'LANCER', 2011), []);
  assert.deepEqual(matchClassDCandidates(index, 'FIAT', 'PANDA', 2014), []);
});
