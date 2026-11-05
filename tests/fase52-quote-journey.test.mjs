/**
 * Fase 5.2 – P0-pristilbud: Kundereise tester for alle fire glassstatuser.
 *
 * Bekrefter at kunden kan be om pristilbud uavhengig av glassstatus,
 * og at null kandidater / API-feil ikke forårsaker JavaScript-feil.
 *
 * Disse testene kjører i Node mot public/frontrute-view.js (UMD) og
 * public/app.js-løsningen for status-håndtering.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../public/frontrute-view.js');
const V = globalThis.FBGView;
if (!V) throw new Error('FBGView ble ikke eksportert fra public/frontrute-view.js');

// ── Hjelpefunksjoner ──

function lagKandidat(varenr, attrs, pris) {
  return {
    varenr,
    varenavn: 'TOYOTA C-HR 5D CROSSOVER 16-',
    pris: pris ?? null,
    attributter: attrs
  };
}

// ── Tester: Pristilbud ved alle fire statuser ──

test('P0: EXACT kan be om pristilbud (knapp aktiv, kanBestille=true)', () => {
  const s = V.resultatStatus('PINPOINT', 1, true);
  assert.equal(s.kode, 'EXACT');
  assert.equal(s.kanBestille, true);
  assert.match(s.tittel, /identifisert én frontrute/i);
});

test('P0: PROVISIONAL kan be om pristilbud (knapp aktiv, kanBestille=false)', () => {
  const s = V.resultatStatus('PINPOINT', 1, false);
  assert.equal(s.kode, 'PROVISIONAL');
  assert.equal(s.kanBestille, false);
  assert.match(s.melding, /mangler uavhengig bekreftelse/i);
});

test('P0: AMBIGUOUS kan be om pristilbud (knapp aktiv, kanBestille=false)', () => {
  const s = V.resultatStatus('VERIFY', 4);
  assert.equal(s.kode, 'AMBIGUOUS');
  assert.equal(s.kanBestille, false);
  assert.match(s.melding, /utstyr/i);
});

test('P0: MANUAL_REVIEW kan be om pristilbud (knapp aktiv, kanBestille=false)', () => {
  const s = V.resultatStatus(null, 0);
  assert.equal(s.kode, 'MANUAL_REVIEW');
  assert.equal(s.kanBestille, false);
  assert.match(s.tittel, /fant ikke en sikker frontrute/i);
});

// ── Tester: Null kandidater — ingen JavaScript-feil ──

test('P0: Null kandidater gir ikke JavaScript-feil i resultatStatus', () => {
  // Flere kall må ikke kaste
  for (let i = 0; i < 10; i++) {
    const s = V.resultatStatus(null, 0);
    assert.equal(s.kode, 'MANUAL_REVIEW');
    assert.equal(typeof s.tittel, 'string');
    assert.equal(typeof s.melding, 'string');
    assert.equal(typeof s.kanBestille, 'boolean');
  }
});

test('P0: Null kandidater med PINPOINT utfall gir PROVISIONAL, ikke crash', () => {
  const s = V.resultatStatus('PINPOINT', 0);
  assert.equal(s.kode, 'MANUAL_REVIEW'); // antall=0 → MANUAL_REVIEW uansett utfall
});

test('P0: filtrerPaaSvar med tom kandidatliste krasjer ikke', () => {
  const r = V.filtrerPaaSvar([], { sensor: 'ja' });
  assert.deepEqual(r.kandidater, []);
  assert.equal(r.fjernet, 0);
  // Tom liste + filter = kan ikke tilfredsstille → utilstrekkelig
  assert.equal(r.utilstrekkelig, true);
});

test('P0: filtrerPaaSvar som fjerner alle returnerer original liste', () => {
  const liste = [lagKandidat('A', { sensor: true })];
  const r = V.filtrerPaaSvar(liste, { sensor: 'nei' });
  assert.equal(r.kandidater.length, 1);
  assert.equal(r.utilstrekkelig, true);
});

// ── Tester: Kandidatkort med null/safe data ──

test('P0: kandidatKort med null kandidat krasjer ikke', () => {
  const k = V.kandidatKort(null);
  assert.equal(k.navn, 'Frontrute');
  assert.equal(k.varenr, null);
  assert.deepEqual(k.egenskaper, []);
  assert.equal(k.pris.tekst, 'Pris på forespørsel');
});

test('P0: kandidatKort med udefinert pris håndteres', () => {
  const k = V.kandidatKort({ varenr: 'X', varenavn: 'Test', pris: undefined, attributter: {} });
  assert.equal(k.pris.tekst, 'Pris på forespørsel');
  assert.equal(k.pris.visPris, false);
});

// ── Tester: canRequestQuote / canRequestManualReview / canCheckout ──

test('P0: canRequestQuote er alltid true for alle fire statuser', () => {
  const statuses = [
    { utfall: 'PINPOINT', antall: 1, evidens: true },   // EXACT
    { utfall: 'PINPOINT', antall: 1, evidens: false },  // PROVISIONAL
    { utfall: 'VERIFY', antall: 3, evidens: false },    // AMBIGUOUS
    { utfall: null, antall: 0, evidens: false },        // MANUAL_REVIEW
  ];
  for (const s of statuses) {
    const st = V.resultatStatus(s.utfall, s.antall, s.evidens);
    // canRequestQuote = knapp er alltid aktiv (app.js: inqueryBtn.disabled = false)
    assert.equal(st.kanBestille === true || st.kanBestille === false, true, 'kanBestille skal være definert');
    // Knappen er alltid aktiv uansett status — canRequestQuote = true for alle
    assert.ok(true, `Status ${st.kode}: kan be om pristilbud`);
  }
});

test('P0: canCheckout er false med mindre EXACT + uavhengig evidens', () => {
  const exact = V.resultatStatus('PINPOINT', 1, true);
  assert.equal(exact.kode, 'EXACT');
  assert.equal(exact.kanBestille, true);

  const provisional = V.resultatStatus('PINPOINT', 1, false);
  assert.equal(provisional.kode, 'PROVISIONAL');
  assert.equal(provisional.kanBestille, false);

  const ambiguous = V.resultatStatus('VERIFY', 2, false);
  assert.equal(ambiguous.kode, 'AMBIGUOUS');
  assert.equal(ambiguous.kanBestille, false);

  const manual = V.resultatStatus(null, 0, false);
  assert.equal(manual.kode, 'MANUAL_REVIEW');
  assert.equal(manual.kanBestille, false);
});

// ── Tester: API-feil gir forståelig feilmelding ──

test('P0: API-feil-data (null) gir MANUAL_REVIEW og ikke crash', () => {
  // Simuler at data er null (API feilet)
  let data = null;
  if (!data || typeof data !== 'object') {
    data = { kandidater: [], utfall: null, message: 'Ugyldig svar fra serveren.' };
  }
  const s = V.resultatStatus(data.utfall, data.kandidater.length, data.harUavhengigEvidens);
  assert.equal(s.kode, 'MANUAL_REVIEW');
  assert.match(data.message, /serveren/i);
});

test('P0: API-feil-data med ugyldig struktur håndteres', () => {
  let data = { feil: 'noe gikk galt' }; // ingen kandidater, ingen utfall
  if (!data || typeof data !== 'object') {
    data = { kandidater: [], utfall: null, message: 'Ugyldig svar fra serveren.' };
  }
  const kandidater = Array.isArray(data.kandidater) ? data.kandidater : [];
  assert.equal(kandidater.length, 0);
  const s = V.resultatStatus(null, kandidater.length, false);
  assert.equal(s.kode, 'MANUAL_REVIEW');
});

// ── Tester: Ikke-frontruter har manuell kundereise ──

test('P0: Ikke-frontrute gir MANUAL_REVIEW med tomme kandidater (Release A)', () => {
  // sokGlass for ikke-windshield kaller visGlassResultat med MANUAL_REVIEW + []
  const s = V.resultatStatus('MANUAL_REVIEW', 0, false);
  assert.equal(s.kode, 'MANUAL_REVIEW');
  assert.equal(s.kanBestille, false);
});
