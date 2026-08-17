import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * FITMENT TRUTH BASELINE — deterministisk golden-lane (Phase A0).
 *
 * Dette er den CI-blokkerbare regresjonen for fitment-SANNHET.
 * Ingen nettverk, ingen SVV, ingen D1, ingen prod-API.
 * Den validerer:
 *   1. Struktur/vokabular i data/fitment-golden.json.
 *   2. Doktrine: verifikasjonsstatus != VERIFIED => aldri AUTO_MATCH.
 *   3. "1 kandidat != sannhet": ingen AUTO_MATCH uten uavhengig evidens.
 *   4. Deterministiske strukturfakta (ISO 3779 VIN-år) for kjente fasiter.
 *
 * Kjøres med `npm run test:fitment:golden`.
 * Skiller seg FRA test:fitment:live (som treffer prod og måler drift).
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const golden = JSON.parse(readFileSync(join(ROOT, 'data', 'fitment-golden.json'), 'utf8'));

const DECISIONS = new Set(['AUTO_MATCH', 'NEEDS_CONFIRMATION', 'MANUAL_REVIEW']);
const VERIFICATIONS = new Set(['VERIFIED', 'PROVISIONAL', 'AMBIGUOUS', 'UNVERIFIED', 'CONFLICTING']);

test('golden-register: gyldig struktur og vokabular', () => {
  assert.ok(Array.isArray(golden.fixtures), 'fixtures må være array');
  assert.ok(golden.fixtures.length >= 2, 'forventer minst SU18018 + AJ95429');
  for (const f of golden.fixtures) {
    assert.ok(f.id, 'fixture mangler id');
    assert.ok(DECISIONS.has(f.expectedDecision), `${f.id}: ugyldig expectedDecision=${f.expectedDecision}`);
    assert.ok(VERIFICATIONS.has(f.verificationState), `${f.id}: ugyldig verificationState=${f.verificationState}`);
    assert.ok(VERIFICATIONS.has(f.verificationStatus), `${f.id}: ugyldig verificationStatus=${f.verificationStatus}`);
    assert.strictEqual(f.verificationState, f.verificationStatus, `${f.id}: verificationState og verificationStatus må samsvare`);
    assert.strictEqual(typeof f.independentEvidenceAvailable, 'boolean', `${f.id}: independentEvidenceAvailable må være boolean`);
  }
});

test('doktrine: ikke-VERIFIED skal aldri utløse AUTO_MATCH', () => {
  for (const f of golden.fixtures) {
    if (f.verificationState !== 'VERIFIED') {
      assert.notStrictEqual(f.expectedDecision, 'AUTO_MATCH', `${f.id}: ${f.verificationState} må IKKE være AUTO_MATCH`);
    }
  }
});

test('doktrine: AUTO_MATCH krever uavhengig evidens (1 kandidat != sannhet)', () => {
  for (const f of golden.fixtures) {
    if (f.expectedDecision === 'AUTO_MATCH') {
      assert.strictEqual(f.independentEvidenceAvailable, true, `${f.id}: AUTO_MATCH uten uavhengig evidens er forbudt`);
      assert.strictEqual(f.verificationState, 'VERIFIED', `${f.id}: AUTO_MATCH krever VERIFIED`);
    }
  }
});

test('doktrine: AMBIGUOUS/CONFLICTING gir minst NEEDS_CONFIRMATION', () => {
  for (const f of golden.fixtures) {
    if (f.verificationState === 'AMBIGUOUS' || f.verificationState === 'CONFLICTING') {
      assert.ok(['NEEDS_CONFIRMATION', 'MANUAL_REVIEW'].includes(f.expectedDecision), `${f.id}: ${f.verificationState} => ${f.expectedDecision}`);
    }
  }
});

test('SU18018: klassifisert PROVISIONAL og aldri AUTO_MATCH (regresjon mot falsk fasit)', () => {
  const f = golden.fixtures.find((x) => x.id === 'SU18018');
  assert.ok(f, 'SU18018 må finnes');
  assert.strictEqual(f.verificationState, 'PROVISIONAL');
  assert.strictEqual(f.expectedDecision, 'NEEDS_CONFIRMATION');
  // Regresjon: den tidligere feilen var å erklære 2525CSGY (coated) som riktig.
  assert.strictEqual(f.expectedEurocode, '8579AGSGYAVZ1B');
  assert.strictEqual(f.expectedVarenr, '2525GYA');
});

test('AJ95429: klassifisert AMBIGUOUS og aldri AUTO_MATCH', () => {
  const f = golden.fixtures.find((x) => x.id === 'AJ95429');
  assert.ok(f, 'AJ95429 må finnes');
  assert.strictEqual(f.verificationState, 'AMBIGUOUS');
  assert.strictEqual(f.expectedDecision, 'NEEDS_CONFIRMATION');
});

// Deterministisk strukturfakta (ISO 3779 / VIN pos 10) — VERIFIED, uavhengig av prod-data.
const ISO_YEAR = { A:1980,B:1981,C:1982,D:1983,E:1984,F:1985,G:1986,H:1987,J:1988,K:1989,L:1990,M:1991,N:1992,P:1993,R:1994,S:1995,T:1996,V:1997,W:1998,X:1999,Y:2000,'1':2001,'2':2002,'3':2003,'4':2004,'5':2005,'6':2006,'7':2007,'8':2008,'9':2009 };
function vinYear(vin) { return ISO_YEAR[vin.charAt(9)] ?? null; }

test('SU18018: VIN-strukturfakta er VERIFIED (WMI/VDS/år)', () => {
  const f = golden.fixtures.find((x) => x.id === 'SU18018');
  assert.strictEqual(f.vin.slice(0, 3), 'WV1', 'WMI WV1 = VW Commercial Vehicles');
  assert.strictEqual(f.vin.slice(3, 6), 'ZZZ', 'pos 4-6 filler');
  assert.strictEqual(f.vin.slice(6, 8), '7H', 'pos 7-8 = 7H = T5 Transporter');
  assert.strictEqual(vinYear(f.vin), 2005, 'VIN pos 10 = 2005');
});
