import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClassDCandidates, matchClassDCandidates } from '../src/fitment-v1/catalogue-candidates.js';

/** Synthetic own-catalogue rows only: no external API, personal data or third-party copy. */
const rows = [
  { varenr: 'ASX-TEST', eurokode: '5689AGNV', varenavn: 'MITSUBISHI ASX FRONTRUTE 10-' },
  { varenr: 'CX5-I-TEST', eurokode: '5179AGNGY', varenavn: 'MAZDA CX-5 FRONTRUTE 12-' },
  { varenr: 'CX5-II-TEST', eurokode: '5187AGNPV', varenavn: 'MAZDA CX-5 II FRONTRUTE 17-' },
  { varenr: 'FIAT-ICE-TEST', eurokode: '3366AGNGY1B', varenavn: 'FIAT 500 FRONTRUTE 07-' },
  { varenr: 'FIAT-EV-TEST', eurokode: '3366AGNPV1E', varenavn: 'FIAT 500 ELECTRIC FRONTRUTE 20-' },
  { varenr: 'UP-TEST', eurokode: '8613AGNV', varenavn: 'VW UP! FRONTRUTE 11-' },
];
const candidates = buildClassDCandidates(rows);
const skus = (results) => results.map((r) => r.varenr);

test('Own catalogue: Mitsubishi ASX 2011 is candidate-only', () => {
  const found = matchClassDCandidates(candidates, 'Mitsubishi', 'ASX', 2011);
  assert.deepEqual(skus(found), ['ASX-TEST']);
  assert.equal(found[0].klassifisering, 'CLASS_D_CATALOGUE_CANDIDATE');
});

test('Mazda CX-5 2017 preserves overlapping generations as candidates', () => {
  const found = matchClassDCandidates(candidates, 'Mazda', 'CX-5', 2017);
  assert.deepEqual(skus(found), ['CX5-I-TEST', 'CX5-II-TEST']);
  assert.ok(found.every((r) => r.klassifisering === 'CLASS_D_CATALOGUE_CANDIDATE'));
});

test('Fiat 500 Electric never matches Fiat 500 combustion-catalogue family', () => {
  assert.deepEqual(skus(matchClassDCandidates(candidates, 'FIAT', '500 Electric', 2021)), ['FIAT-EV-TEST']);
  assert.deepEqual(skus(matchClassDCandidates(candidates, 'FIAT', '500e', 2021)), ['FIAT-EV-TEST']);
  assert.deepEqual(skus(matchClassDCandidates(candidates, 'FIAT', '500', 2021)), ['FIAT-ICE-TEST']);
});

test('Volkswagen and VW up! aliases match with conservative year filtering', () => {
  assert.deepEqual(skus(matchClassDCandidates(candidates, 'Volkswagen', 'up!', 2018)), ['UP-TEST']);
  assert.deepEqual(skus(matchClassDCandidates(candidates, 'VW', 'UP', 2018)), ['UP-TEST']);
  assert.deepEqual(skus(matchClassDCandidates(candidates, 'VW', 'UP', 2010)), []);
});

test('No accidental matching of 500L to 500 or CUPRA to up', () => {
  assert.deepEqual(skus(matchClassDCandidates(candidates, 'FIAT', '500L', 2015)), []);
  assert.deepEqual(skus(matchClassDCandidates(candidates, 'VW', 'CUPRA', 2018)), []);
});

test('Unrepresented models still return no candidates instead of guessing', () => {
  assert.deepEqual(matchClassDCandidates(candidates, 'Mercedes', 'CLA', 2016), []);
  assert.deepEqual(matchClassDCandidates(candidates, 'Mazda', 'CX-50', 2025), []);
});

test('Side glass and accessory rows are not emitted as windscreen candidates', () => {
  const extra = buildClassDCandidates([
    { varenr: 'ASX-PY', eurokode: '5689AGNV', varenavn: 'MITSUBISHI ASX PYNTELIST 10-' },
    { varenr: 'ASX-SIDE', eurokode: '5689LGN', varenavn: 'MITSUBISHI ASX SIDERUTE 10-' },
    { varenr: 'ASX-WINDSCREEN', eurokode: '5689AGNV', varenavn: 'MITSUBISHI ASX FRONTRUTE 10-' },
  ]);
  assert.deepEqual(skus(matchClassDCandidates(extra, 'MITSUBISHI', 'ASX', 2011)), ['ASX-WINDSCREEN']);
});
