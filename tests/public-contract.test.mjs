/**
 * Kontrakttester for offentlig glass-API (Tom-beslutning 2026-10-31).
 *
 * Kunden skal se produkter og bekreftet NOK-pris. Eurokode, SKU-fingeravtrykk,
 * typeCode, side og kilde-metadata skal ALDRI ut i et offentlig svar.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  tilOffentligKandidat,
  tilOffentligSvar,
  offentligPris,
  lekkerInterneFelt,
  INTERNE_FELT,
} from '../src/public-contract.ts';

const INTERN = {
  varenr: '2525GYA',
  varenavn: 'VW TRANSP+CARAVELLE T5 2003- FRONTRUTE',
  eurokode: '8579AGSGYAVZ1B',
  skuFingerprint: '8579AGSGYAVZ1B-2525GYA',
  typeCode: 'FW',
  side: 'frontrute',
  canonicalUrl: 'https://finnbilglass.no/glas/2525GYA',
  pris: 9980,
};

test('offentlig kandidat: eurokode og fingeravtrykk slipper ikke ut', () => {
  const ut = tilOffentligKandidat(INTERN);
  assert.equal(ut.varenr, '2525GYA');
  assert.equal(ut.canonicalUrl, 'https://finnbilglass.no/glas/2525GYA');
  assert.deepEqual(lekkerInterneFelt(ut), []);
  for (const felt of INTERNE_FELT) {
    assert.equal(felt in ut, false, `${felt} lekker`);
  }
});

test('offentlig kandidat: bekreftet listepris gir kundepris med mva', () => {
  const ut = tilOffentligKandidat(INTERN);
  assert.deepEqual(ut.pris, { kundePris: 5490, mva: 1098, prisEksMva: 4392 });
});

test('offentlig pris: manglende eller ugyldig grunnlag gir null, ikke fabrikkert tall', () => {
  assert.equal(offentligPris(null), null);
  assert.equal(offentligPris(undefined), null);
  assert.equal(offentligPris(0), null);
  assert.equal(offentligPris(-100), null);
  assert.equal(offentligPris(Number.NaN), null);
});

test('svar med pris er OK, svar uten pris er MANUAL_REVIEW', () => {
  const medPris = tilOffentligSvar({
    candidates: [INTERN],
    totalAvailable: 1,
    hasMore: false,
  });
  assert.equal(medPris.status, 'OK');

  const utenPris = tilOffentligSvar({
    candidates: [{ ...INTERN, pris: null }],
    totalAvailable: 1,
    hasMore: false,
  });
  assert.equal(utenPris.status, 'MANUAL_REVIEW');
  assert.equal(utenPris.candidates[0].pris, null);
});

test('tomt resultat gir MANUAL_REVIEW og ingen kandidater', () => {
  const tomt = tilOffentligSvar({ candidates: [], totalAvailable: 0, hasMore: false });
  assert.equal(tomt.status, 'MANUAL_REVIEW');
  assert.deepEqual(tomt.candidates, []);
});

test('paginering bevares uten å eksponere interne felt', () => {
  const s = tilOffentligSvar({
    candidates: [INTERN],
    totalAvailable: 54,
    hasMore: true,
    nextCursor: '20',
  });
  assert.equal(s.hasMore, true);
  assert.equal(s.nextCursor, '20');
  assert.equal(s.totalAvailable, 54);
  assert.deepEqual(lekkerInterneFelt(s), []);
});

test('lekkerInterneFelt avdekker interne felt også nøstet', () => {
  const funnet = lekkerInterneFelt({ a: [{ eurokode: 'X' }], b: { innkjopspris: 100 } });
  assert.deepEqual(funnet.sort(), ['eurokode', 'innkjopspris']);
});

test('/api/glass bruker den offentlige kontrakten', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'index.ts'), 'utf8');
  assert.match(src, /tilOffentligSvar\(result\)/);
  assert.doesNotMatch(src, /json\(\{ success: true, data: result \}\)/, 'rå discovery-resultat skal ikke returneres');
});

test('discovery henter listepris slik at kontrakten kan beregne kundepris', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'discovery.ts'), 'utf8');
  assert.match(src, /pris\??:\s*number \| null/);
  assert.match(src, /pris:\s*typeof r\.pris === 'number'/);
});
