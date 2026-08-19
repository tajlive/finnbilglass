// glass-sku-modellen: mapper + normalisering (Oppgave 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGlavistaProps, glavistaTint, glavistaTilAttributes,
  byggSkuFraGlavista, gtTilVehicleRule, fasitTilSku,
  leggTilGtRule, parseAarIntervall, ukjenteAttributter,
} from '../src/fitment-v1/glass-sku.ts';

test('parseGlavistaProps: Mirror boss → cameraBracket', () => {
  const a = parseGlavistaProps('Mirror boss, Rain, light, defogging sensor, VIN notch');
  assert.equal(a.cameraBracket, true);
  assert.equal(a.rainLightSensor, true);
  assert.equal(a.heating, true);
  assert.equal(a.hud, undefined); // ikke nevnt → ukjent
});

test('parseGlavistaProps: HUD og acoustic gjenkjennes', () => {
  const a = parseGlavistaProps('HUD, Acoustic, Antenna');
  assert.equal(a.hud, true);
  assert.equal(a.acoustic, true);
  assert.equal(a.antenna, true);
});

test('parseGlavistaProps: tom/undefined → ingen attributter (aldri fabrikkert)', () => {
  assert.deepEqual(parseGlavistaProps(undefined), {});
  assert.deepEqual(parseGlavistaProps(''), {});
});

test('glavistaTint: fargetone-mapping (konservativ)', () => {
  assert.equal(glavistaTint('Green Solar Grey'), 'GS');
  assert.equal(glavistaTint('Light Green'), 'GN');
  assert.equal(glavistaTint('Bronze'), 'BZ');
  assert.equal(glavistaTint(undefined), null);
});

test('byggSkuFraGlavista: komplett SKU med proveniens', () => {
  const sku = byggSkuFraGlavista('6729AGSGYMVWZ', {
    oe: ['7P5845099E'], glavistaNr: '101168', modell: 'PORSCHE CAYENNE 5T 2010-',
    merke: 'PORSCHE', tinting: 'Green Solar Grey',
    props: 'Mirror boss, Rain, light, defogging sensor, VIN notch',
  });
  assert.equal(sku.sku, 'GLAVISTA:101168');
  assert.equal(sku.status, 'candidate'); // katalog alene er aldri verified
  assert.equal(sku.attributes.cameraBracket, true);
  assert.equal(sku.attributes.rainLightSensor, true);
  assert.equal(sku.attributes.tint, 'GS');
  assert.equal(sku.vehicleRules[0].make, 'PORSCHE');
  assert.equal(sku.vehicleRules[0].yearFrom, 2010);
  assert.equal(sku.vehicleRules[0].yearTo, null);
  assert.deepEqual(sku.oemPartNumbers, ['7P5845099E']);
  assert.ok(sku.evidence[0].sourceClass === 'INDEPENDENT_CATALOG');
});

test('parseAarIntervall: åpne og lukkede intervall', () => {
  assert.deepEqual(parseAarIntervall('VW TRANSP+T5 2003-'), { from: 2003, to: null });
  assert.deepEqual(parseAarIntervall('BMW 3ER F30 2011-2018'), { from: 2011, to: 2018 });
  assert.deepEqual(parseAarIntervall('TOYOTA LANDCRUISER 3T + 5T 1996-'), { from: 1996, to: null });
  assert.deepEqual(parseAarIntervall('uten årstall'), { from: null, to: null });
});

test('gtTilVehicleRule: GT-regel med proveniens', () => {
  const r = gtTilVehicleRule({ make: 'VW', model: 'TRANSPORTER', year: 2005, frontruteEurocode: '8579AGSGYAVZ1B', verifiedBy: 'gt-auto-prisliste', confidence: 0.8 });
  assert.equal(r.make, 'VW');
  assert.equal(r.source, 'ground-truth');
  assert.equal(r.confidence, 0.8);
  assert.equal(r.provenance.sourceClass, 'INTERNAL_CATALOG');
});

test('gtTilVehicleRule: manglende eurokode → null (aldri fabrikk)', () => {
  assert.equal(gtTilVehicleRule({ make: 'VW', model: 'X', year: 2000, frontruteEurocode: '' }), null);
});

test('fasitTilSku: fasit → verified-SKU med AUTORITATIV evidens', () => {
  const f = fasitTilSku({ regnr: 'SU18018', vin: 'WV1ZZZ7HZ5H060934', bil: 'VW Transporter T5 2005', varenr: '2525GYA', eurocode: '8579AGSGYAVZ1B', kilde: 'tom-fasit' });
  assert.equal(f.status, 'verified');
  assert.equal(f.varenr, '2525GYA');
  assert.equal(f.evidence[0].sourceClass, 'AUTHORITATIVE');
  assert.equal(f.vehicleRules[0].yearFrom, 2005);
});

test('leggTilGtRule: idempotent (ingen duplikat-regler)', () => {
  const sku = byggSkuFraGlavista('X', { glavistaNr: '1', modell: 'VW T5 2003-', merke: 'VW' });
  const r = gtTilVehicleRule({ make: 'VW', model: 'T5', year: 2003, frontruteEurocode: 'X' });
  const a = leggTilGtRule(sku, r);
  const b = leggTilGtRule(a, r);
  assert.equal(b.vehicleRules.filter((v) => v.source === 'ground-truth').length, 1);
});

test('ukjenteAttributter: null = ukjent, windshield unntatt', () => {
  const sku = byggSkuFraGlavista('X', { glavistaNr: '1', modell: 'X 2000-', merke: 'X' });
  const u = ukjenteAttributter(sku.attributes);
  assert.ok(u.includes('hud'));
  assert.ok(u.includes('cameraBracket'));
  assert.ok(!u.includes('windshield'));
});

test('glavistaTilAttributes: alle nevnte attributter true, resten null', () => {
  const a = glavistaTilAttributes({ props: 'HUD, Acoustic, Antenna, Rain', tinting: 'Blue' });
  assert.equal(a.hud, true);
  assert.equal(a.acoustic, true);
  assert.equal(a.antenna, true);
  assert.equal(a.rainLightSensor, true);
  assert.equal(a.cameraBracket, null);
  assert.equal(a.heating, null);
  assert.equal(a.tint, 'BL');
});
