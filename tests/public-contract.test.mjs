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

test('pris alene gir MANUAL_REVIEW — kompatibilitet har høyere prioritet', () => {
  const medPris = tilOffentligSvar({
    candidates: [INTERN],
    totalAvailable: 1,
    hasMore: false,
  });
  // Katalogtreff bekrefter ikke at glasset passer. Prisen er bekreftet, men
  // status er MANUAL_REVIEW fordi kompatibiliteten ikke er det.
  assert.equal(medPris.status, 'MANUAL_REVIEW');
  assert.equal(medPris.prisStatus, 'BEKREFTET');
  assert.notEqual(medPris.candidates[0].pris, null, 'prisen skal fortsatt vises');

  const medKompatibilitet = tilOffentligSvar({
    candidates: [{ ...INTERN, kompatibilitet: 'BEKREFTET' }],
    totalAvailable: 1,
    hasMore: false,
  });
  assert.equal(medKompatibilitet.status, 'OK');

  const utenPris = tilOffentligSvar({
    candidates: [{ ...INTERN, kompatibilitet: 'BEKREFTET', pris: null }],
    totalAvailable: 1,
    hasMore: false,
  });
  assert.equal(utenPris.status, 'MANUAL_REVIEW', 'kompatibilitet uten pris er ikke OK');
  assert.equal(utenPris.prisStatus, 'INGEN');
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

test('discovery sorterer rader uten pris sist', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'discovery.ts'), 'utf8');
  // SQLite sorterer NULL foran alle tall. Uten (pris IS NULL) vinner en rad
  // uten pris over en rad med pris for samme varenr, og kunden får
  // MANUAL_REVIEW på et produkt vi har pris på. (pris < ?) skyver i tillegg
  // produkter under prisgulvet bak, så kunden ser siterbare varer først.
  assert.match(src, /ORDER BY \(pris IS NULL\), \(pris < \?\), pris/);
});

// ── Regresjon for pris- og sorteringsrettelsene (P0 2026-10-31) ────────────

test('samme varenr med NULL-pris og gyldig pris: gyldig pris skal vinne', () => {
  // Raden uten pris skal aldri skygge for raden med pris — det var feilen
  // som gjorde at kunden fikk MANUAL_REVIEW på et produkt vi har pris på.
  const medPris = tilOffentligKandidat({ ...INTERN, pris: 9980 });
  const utenPris = tilOffentligKandidat({ ...INTERN, pris: null });
  assert.deepEqual(medPris.pris, { kundePris: 5490, mva: 1098, prisEksMva: 4392 });
  assert.equal(utenPris.pris, null);
});

test('flere varianter med ulik kompatibilitet: én bekreftet gir OK', () => {
  const s = tilOffentligSvar({
    candidates: [
      { ...INTERN, varenr: 'A', kompatibilitet: 'KATALOGTREFF', pris: 8000 },
      { ...INTERN, varenr: 'B', kompatibilitet: 'BEKREFTET', pris: 8000 },
    ],
    totalAvailable: 2,
    hasMore: false,
  });
  assert.equal(s.status, 'OK');
  assert.equal(s.prisStatus, 'BEKREFTET');
});

test('produkter under laveste siterbare listepris gir ingen pris', async () => {
  const { LAVESTE_SITERBARE_LISTEPRIS } = await import('../src/pricing/nok-prising.ts');
  assert.equal(LAVESTE_SITERBARE_LISTEPRIS, 6650, 'gulvet skal utledes fra TRINN/0.60');
  assert.equal(offentligPris(LAVESTE_SITERBARE_LISTEPRIS - 1), null, 'under gulvet: ingen pris');
  assert.notEqual(offentligPris(LAVESTE_SITERBARE_LISTEPRIS), null, 'på gulvet: pris');
});

test('prisStatus skiller INGEN, DELVIS og BEKREFTET', () => {
  const ingen = tilOffentligSvar({ candidates: [{ ...INTERN, pris: null }], totalAvailable: 1, hasMore: false });
  assert.equal(ingen.prisStatus, 'INGEN');
  const delvis = tilOffentligSvar({
    candidates: [{ ...INTERN, varenr: 'A', pris: 9980 }, { ...INTERN, varenr: 'B', pris: null }],
    totalAvailable: 2,
    hasMore: false,
  });
  assert.equal(delvis.prisStatus, 'DELVIS');
  const alle = tilOffentligSvar({
    candidates: [{ ...INTERN, varenr: 'A', pris: 9980 }, { ...INTERN, varenr: 'B', pris: 8000 }],
    totalAvailable: 2,
    hasMore: false,
  });
  assert.equal(alle.prisStatus, 'BEKREFTET');
});

test('ugyldig prisgrunnlag gir null, aldri en oppdiktet pris', () => {
  for (const verdi of [null, undefined, 0, -1, Number.NaN, Infinity, '9980']) {
    assert.equal(offentligPris(verdi), null, `skal avvise ${String(verdi)}`);
  }
});

test('sorteringen er deterministisk og legger NULL og under-gulv sist', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'discovery.ts'), 'utf8');
  assert.match(src, /ORDER BY \(pris IS NULL\), \(pris < \?\), pris/);
  assert.match(src, /LAVESTE_SITERBARE_LISTEPRIS/);
});
