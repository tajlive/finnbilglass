/**
 * fitment-v1 — deterministiske kjernetester (TypeScript-port av A3 27/27 + shadow).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KTypeIdentity } from '../src/fitment-v1/domain.js';
import { canonicalOE, normalizeOE, oeTokens, sameOEPart } from '../src/fitment-v1/normalization/oe.js';
import { EvidenceKernel, buildQuestions } from '../src/fitment-v1/policy/kernel.js';
import { GlavistaAdapter } from '../src/fitment-v1/adapters/glavista.js';
import { buildShadowComparison, type LegacyResult } from '../src/fitment-v1/shadow.js';
import { evaluateExactGate } from '../src/fitment-v1/policy/gate.js';

const kernel = new EvidenceKernel();

test('kType: samme rå integer fra ulike namespaces er ALDRI samme identitet', () => {
  const a = new KTypeIdentity({ provider: 'Bovsoft', namespace: 'SVV', version: '2024', id: 17370 });
  const b = new KTypeIdentity({ provider: 'TecDoc', namespace: 'TECDOC', version: '2019Q1', id: 17370 });
  assert.notEqual(a.key(), b.key());
  assert.equal(a.equals(b), false);
  assert.equal(KTypeIdentity.sameRawId(a, b), true, 'rå integer lik — men det er IKKE nok');
});

test('OE: revisjonsbokstaver bevares, rå verdi immutabel, normalisert avledet', () => {
  const oe = normalizeOE('7H0 845 101 H');
  assert.equal(oe.rawOE, '7H0 845 101 H');
  assert.equal(oe.normalizedOE, '7H0845101H');
  assert.equal(oe.rawOE, '7H0 845 101 H', 'rå verdi endres aldri');
  const f = normalizeOE('7H0845101F');
  assert.equal(oe.normalizedOE === f.normalizedOE, false, 'H og F er ulike OE-er — revisjonsbokstav er fitment-kritisk');
  assert.equal(canonicalOE('7e0 845 099 h'), '7E0845099H');
  assert.equal(sameOEPart('A1176700500', '1176700500'), true, 'Mercedes A-prefiks ignoreres ved sammenlikning');
  assert.deepEqual(oeTokens('A1176700500'), ['A-PREFIX', '1176700500']);
});

test('SU18018: initial AMBIGUOUS/HEURISTIC_ONLY med 6 kandidater', () => {
  const r = kernel.resolve({ registrationNumber: 'SU18018', vin: 'WV1ZZZ7HZ5H060934', make: 'VW', model: 'Transporter T5 2005', modelYear: 2005, firstRegistrationDate: '2005-04-20' });
  assert.equal(r.fitmentStatus, 'AMBIGUOUS');
  assert.equal(r.verificationMode, 'HEURISTIC_ONLY');
  assert.equal(r.selectedGlass, null);
  assert.equal(r.candidates.length, 6);
  assert.ok(r.reasonCodes.includes('APPLICATION_LINKAGE_NOT_AUTHORITATIVE'));
  assert.ok(r.evidence.length >= 20);
});

test('SU18018: OE 7H0845101H (bekreftet kundeobservasjon) → EXACT + CUSTOMER_OBSERVATION 2525GYA', () => {
  const r = kernel.resolveWithObservation(
    { registrationNumber: 'SU18018', vin: 'WV1ZZZ7HZ5H060934', make: 'VW', model: 'Transporter T5 2005', modelYear: 2005 },
    [{ type: 'OE', value: '7H0845101H', reliable: true, notes: 'kundebekreftet' }],
  );
  assert.equal(r.fitmentStatus, 'EXACT');
  assert.equal(r.verificationMode, 'CUSTOMER_OBSERVATION');
  assert.equal(r.selectedGlass?.glass, '8579AGSGYAVZ1B');
  assert.equal(r.selectedGlass?.varenr, '2525GYA');
});

test('AJ95429: 6 kandidater (1B/1T); OE 1176700500 → 2 igjen → AMBIGUOUS', () => {
  const r0 = kernel.resolve({ registrationNumber: 'AJ95429', vin: null, make: 'Mercedes', model: 'CLA 200 D 4MATIC', modelYear: 2016 });
  assert.equal(r0.fitmentStatus, 'AMBIGUOUS');
  assert.equal(r0.candidates.length, 6);
  const r = kernel.resolveWithObservation(
    { registrationNumber: 'AJ95429', vin: null, make: 'Mercedes', model: 'CLA 200 D 4MATIC', modelYear: 2016 },
    [{ type: 'OE', value: '1176700500', reliable: true }],
  );
  assert.equal(r.fitmentStatus, 'AMBIGUOUS', 'to glass på samme OE → aldri EXACT uten separator');
  const eurocodes = r.candidates.map((c) => c.glass).sort();
  assert.deepEqual(eurocodes, ['5381AGACMVW1T', '5381AGSCMVW1T']);
  const discriminators = r.questions.flatMap((q) => q.discriminates);
  assert.ok(discriminators.includes('acoustic'), 'skillende feature for 5381AGACMVW1T vs 5381AGSCMVW1T = acoustic');
});

test('EXACT-gate: én kandidat er IKKE bevis i seg selv (hentet fra gate-regler)', () => {
  const g = evaluateExactGate({ vehicleIdentityResolved: true, applicationEdgeAuthoritative: false, oeGlassEdgeAuthoritativeOrIndependent: true, materialConflicts: [], candidateCount: 1 });
  assert.equal(g.passed, false);
  assert.ok(g.reasonCodes.includes('APPLICATION_LINKAGE_NOT_AUTHORITATIVE'));
});

test('shadow: V1 beregner uavhengig, påvirker ALDRI kunden', () => {
  const v1 = kernel.resolve({ registrationNumber: 'SU18018', vin: 'WV1ZZZ7HZ5H060934', make: 'VW', model: 'Transporter T5 2005', modelYear: 2005 });
  const legacy: LegacyResult = {
    utfall: 'VERIFY', selectedVarenr: null,
    candidateVarenr: ['2525CSGY', '2525GY', '2525GYAM', '2525GYM', '2525GYA', '8579GZPV2'],
    confidence: 0.5, reason: 'L1 (ground_truth): 6 varianter — utstyr må verifiseres',
  };
  const cmp = buildShadowComparison('SU18018', legacy, v1);
  assert.equal(cmp.v1AffectsCustomer, false);
  assert.equal(cmp.decisionDifference, 'SAME'); // legacy VERIFY ≈ V1 AMBIGUOUS
  assert.ok(cmp.candidateOverlap.length >= 4);
  assert.ok(cmp.reasonCodes.length > 0);

  const legacyPin: LegacyResult = { utfall: 'PINPOINT', selectedVarenr: '2525GYA', candidateVarenr: ['2525GYA'], confidence: 0.9, reason: 'ground_truth PINPOINT' };
  const cmp2 = buildShadowComparison('SU18018', legacyPin, v1);
  assert.equal(cmp2.decisionDifference, 'DIFFERENT'); // legacy PINPOINT vs V1 AMBIGUOUS — kjernen sier AMBIGUOUS
});

test('Glavista: R43-deling er reell (43R-DOT/43R deles av tusenvis av eurokoder)', () => {
  const g = new GlavistaAdapter();
  const counts = new Map<string, number>();
  for (const euro of Object.keys((g as unknown as { index: Record<string, unknown> }).index)) {
    const rec = ((g as unknown as { index: Record<string, { cert?: string[] | null }> }).index)[euro];
    for (const c of rec.cert ?? []) {
      const k = String(c).trim();
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const shared = [...counts.entries()].filter(([, n]) => n > 1);
  assert.ok(shared.length > 0, 'minst ett sertifikat deles av flere eurokoder');
  const maxShare = Math.max(...counts.values());
  assert.ok(maxShare >= 1000, `R43 kan aldri identifisere unikt — mest delte sertifikat dekker ${maxShare} eurokoder`);
});

test('spørsmål: buildQuestions skiller kun reelle feature-forskjeller', () => {
  const r = kernel.resolve({ registrationNumber: 'SU18018', vin: 'WV1ZZZ7HZ5H060934', make: 'VW', model: 'Transporter T5 2005', modelYear: 2005 });
  const qs = buildQuestions(r.candidates);
  const discriminators = qs.flatMap((q) => q.discriminates);
  for (const d of ['rainSensor', 'antenna', 'coated']) assert.ok(discriminators.includes(d));
  assert.ok(discriminators.includes('OE'));
});
