/**
 * Frontrute-visning: status, pris og kandidatfiltrering (P0 2026-10-31).
 *
 * Disse funksjonene avgjør hva kunden faktisk ser. Testene kjører i Node mot
 * public/frontrute-view.js (UMD) — ingen nettleser nødvendig.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// package.json er "type": "module", så .js lastes som ESM og UMD-grenen fester
// API-et på globalThis i stedet for module.exports.
require('../public/frontrute-view.js');
const V = globalThis.FBGView;
if (!V) throw new Error('FBGView ble ikke eksportert fra public/frontrute-view.js');

test('status: ingen kandidater gir MANUAL_REVIEW — aldri andre bilers produkter', () => {
  const s = V.resultatStatus(null, 0);
  assert.equal(s.kode, 'MANUAL_REVIEW');
  assert.match(s.tittel, /fant ikke en sikker frontrute/i);
  assert.equal(s.kanBestille, false);
});

test('status: PINPOINT uten evidens gir PROVISIONAL, ikke EXACT', () => {
  const s = V.resultatStatus('PINPOINT', 1);
  assert.equal(s.kode, 'PROVISIONAL');
  assert.doesNotMatch(s.tittel + ' ' + s.melding, /garantert|bekreftet kompatibel/i);
  assert.match(s.melding, /mangler uavhengig bekreftelse|garantere riktig glass/i);
  assert.equal(s.kanBestille, false);
});

test('status: PINPOINT med uavhengig evidens gir EXACT og kan bestilles', () => {
  const s = V.resultatStatus('PINPOINT', 1, true);
  assert.equal(s.kode, 'EXACT');
  assert.match(s.tittel, /identifisert én frontrute/i);
  assert.match(s.melding, /bekreftet/i);
  assert.equal(s.kanBestille, true);
});

test('status: flere kandidater gir AMBIGUOUS, ikke VERIFY', () => {
  const s = V.resultatStatus('VERIFY', 4);
  assert.equal(s.kode, 'AMBIGUOUS');
  assert.equal(s.tittel, 'Vi har funnet flere mulige frontruter til bilen din');
  assert.match(s.melding, /utstyr/i);
  assert.equal(s.kanBestille, false);
});

test('status: FALLBACK uten kandidater blir MANUAL_REVIEW', () => {
  const s = V.resultatStatus('FALLBACK', 0);
  assert.equal(s.kode, 'MANUAL_REVIEW');
  assert.equal(s.kanBestille, false);
  const s2 = V.resultatStatus('FALLBACK', 2);
  assert.equal(s2.kode, 'AMBIGUOUS');
});

test('pris: beregnet pris vises som ESTIMAT med forbehold', () => {
  // Prisen er XLS-listepris eks. mva × 0,25 × 1,25 og kontrolleres manuelt
  // (Tom 2026-10-29). Den skal aldri presenteres som bekreftet pris.
  const p = V.prisTekst(3357.81);
  assert.equal(p.visPris, true);
  assert.equal(p.tekst, 'Estimert pris 3 357,81 kr');
  assert.equal(p.usikker, true, 'estimat skal merkes usikkert');
  assert.match(p.detalj, /inkl\. mva/);
  assert.match(p.detalj, /bekreftes i tilbudet/i);
  assert.match(p.detalj, /frakt/i);
  // Hele kroner vises uten øre.
  assert.equal(V.prisTekst(6250).tekst, 'Estimert pris 6 250 kr');
});

test('pris: manglende eller ugyldig pris gir «Pris på forespørsel»', () => {
  for (const verdi of [null, undefined, 0, -1, Number.NaN, '6990']) {
    const p = V.prisTekst(verdi);
    assert.equal(p.visPris, false, `verdi ${String(verdi)} skal ikke vises`);
    assert.equal(p.tekst, 'Pris på forespørsel');
  }
});

const kandidat = (varenr, attrs, pris) => ({
  varenr,
  varenavn: 'TOYOTA C-HR 5D CROSSOVER 16-',
  pris: pris ?? null,
  attributter: attrs
});

test('filtrering: kjent attributt som skiller fjerner feil kandidat', () => {
  const liste = [kandidat('A', { sensor: true }), kandidat('B', { sensor: false })];
  const r = V.filtrerPaaSvar(liste, { sensor: 'ja' });
  assert.deepEqual(r.kandidater.map((k) => k.varenr), ['A']);
  assert.equal(r.fjernet, 1);
  assert.equal(r.utilstrekkelig, false);
});

test('filtrering: ukjent attributt fjerner aldri kandidaten', () => {
  const liste = [kandidat('A', { sensor: true }), kandidat('B', { sensor: null })];
  const r = V.filtrerPaaSvar(liste, { sensor: 'ja' });
  assert.deepEqual(r.kandidater.map((k) => k.varenr), ['A', 'B']);
});

test('filtrering: «vet ikke» filtrerer ingenting', () => {
  const liste = [kandidat('A', { sensor: true }), kandidat('B', { sensor: false })];
  const r = V.filtrerPaaSvar(liste, { sensor: 'vet-ikke' });
  assert.equal(r.kandidater.length, 2);
});

test('filtrering: hvis alt ville forsvinne, beholdes listen med utilstrekkelig-flagg', () => {
  const liste = [kandidat('A', { sensor: true })];
  const r = V.filtrerPaaSvar(liste, { sensor: 'nei' });
  assert.equal(r.kandidater.length, 1);
  assert.equal(r.utilstrekkelig, true);
});

test('HUD kan ikke utledes: kandidat uten hud-verdi viser ikke HUD i teksten', () => {
  const k = V.kandidatKort(kandidat('A', { oppvarmet: true, hud: null }));
  assert.ok(k.egenskaper.includes('oppvarmet'));
  assert.equal(k.egenskaper.includes('head-up-display'), false);
});

test('kandidatkort: egenskaper kommer fra kjente boolske verdier', () => {
  const k = V.kandidatKort(kandidat('A', { sensor: true, kamera: true, coated: false, oppvarmet: true }));
  assert.deepEqual(k.egenskaper, ['oppvarmet', 'regnsensor', 'kamera']);
  assert.equal(k.pris.tekst, 'Pris på forespørsel');
});

test('antall: viser 6 av 7 når listen er kappet', () => {
  assert.equal(V.antallTekst(6, 7), 'Viser 6 av 7 mulige varianter');
  assert.equal(V.antallTekst(4, 4), null);
  assert.equal(V.antallTekst(4, 2), null);
});

test('spørsmål: HUD-teksten nevner projisert bilde, ikke varmetråder', () => {
  const hjelp = V.sporsmaalHjelp('hud');
  assert.match(hjelp, /projiser/i);
  assert.doesNotMatch(hjelp, /varmetråd/i);
  const oppvarmet = V.sporsmaalHjelp('oppvarmet');
  assert.match(oppvarmet, /varmetråd|knapp/i);
});
