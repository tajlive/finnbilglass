/**
 * C8.4 — Evidence Quality Score-tester.
 * Poengmodell (låst): OE-bilde +50 · montør +40 · 5+ installasjoner +30 · kunde +10 · ekspert +20.
 * Katalog og AI gir 0. WRONG_GLASS eliminerer. Monotonicity: score synker aldri.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceQualityScore, explainQualityScore, MAX_QUALITY_SCORE } from '../src/learning-v1/quality-score.js';

function ev(over = {}) {
  return { id: 'e1', vehicleIdentityHash: 'abc', registrationHash: null, createdAt: Date.now(), sourceType: 'CUSTOMER', evidenceType: 'CAMERA', value: 'true', confidence: 70, status: 'CONFIRMED', createdBy: 'customer', sessionId: null, candidateVarenr: null, supersedes: null, notes: null, ...over };
}
function fx(over = {}) {
  return { fixtureId: 'f1', vehicleIdentityHash: 'abc', candidateVarenr: '2525GYA', eurokode: null, outcome: 'INSTALLED_SUCCESSFULLY', installerId: 'montor-1', confirmedAt: Date.now(), status: 'VERIFIED', sourceOrderId: null, notes: null, ...over };
}
const oeImage = (over = {}) => ev({ id: 'oe1', evidenceType: 'OE', sourceType: 'OE_IMAGE', value: '7H0845101H', createdBy: 'installer', status: 'VERIFIED', ...over });

test('C8.4-1: OE + montør + 5 installasjoner + kunde = 130/150 (Tom-eksempelet)', () => {
  const events = [oeImage(), ev({ sourceType: 'CUSTOMER', evidenceType: 'CAMERA', createdBy: 'customer' })];
  const fixtures = [1, 2, 3, 4, 5].map((i) => fx({ fixtureId: `f${i}`, installerId: `montor-${i}` }));
  const r = evidenceQualityScore(events, fixtures);
  assert.equal(r.score, 130);
  assert.equal(r.maxScore, MAX_QUALITY_SCORE);
  assert.equal(r.confidence, 'HØY');
  assert.equal(r.eliminated, false);
  assert.equal(r.evidenceCount, 4); // OE + montør(≥1) + 5+ + kunde
});

test('C8.4-2: kun katalog (ingen evidens) = 0', () => {
  const r = evidenceQualityScore([], []);
  assert.equal(r.score, 0);
  assert.equal(r.confidence, 'INGEN');
  assert.equal(r.evidenceCount, 0);
  assert.equal(r.eliminated, false);
});

test('C8.4-3: AI-antakelse gir 0 poeng — selv med OE_IMAGE-kilde', () => {
  const r = evidenceQualityScore([oeImage({ createdBy: 'ai' })], []);
  assert.equal(r.score, 0, 'AI-antakelse er aldri evidens');
  assert.equal(r.confidence, 'INGEN');
});

test('C8.4-4: REJECTED-evidens teller ikke', () => {
  const r = evidenceQualityScore([oeImage({ status: 'REJECTED' })], []);
  assert.equal(r.score, 0, 'REJECTED gir 0 poeng');
  assert.equal(r.eliminated, false, 'REJECTED eliminerer ikke, bare teller ikke');
});

test('C8.4-5: WRONG_GLASS eliminerer kandidaten (negativ evidens er absolutt)', () => {
  const r = evidenceQualityScore([oeImage()], [fx({ fixtureId: 'wrong1', outcome: 'WRONG_GLASS' })]);
  assert.equal(r.eliminated, true);
  assert.equal(r.score, 0);
  assert.equal(r.confidence, 'INGEN');
  assert.match(r.eliminateReason, /WRONG_GLASS/);
});

test('C8.4-6: REJECTED WRONG_GLASS eliminerer ikke', () => {
  const r = evidenceQualityScore([oeImage()], [fx({ outcome: 'WRONG_GLASS', status: 'REJECTED' })]);
  assert.equal(r.eliminated, false);
  assert.equal(r.score, 50); // kun OE-bildet teller
});

test('C8.4-7: ekspert fysisk kontroll gir +20 → 150/150 med alle kilder', () => {
  const events = [oeImage(), ev({ sourceType: 'CUSTOMER' })];
  const fixtures = [1, 2, 3, 4, 5].map((i) => fx({ fixtureId: `f${i}` }));
  const r = evidenceQualityScore(events, fixtures, { expertPhysicalVerification: true });
  assert.equal(r.score, 150);
  assert.equal(r.confidence, 'HØY');
});

test('C8.4-8: Monotonicity — score synker aldri når sterkere evidens legges til', () => {
  const s0 = evidenceQualityScore([], []).score;
  const s1 = evidenceQualityScore([ev({ sourceType: 'CUSTOMER' })], []).score;                 // +10
  const s2 = evidenceQualityScore([ev({ sourceType: 'CUSTOMER' }), oeImage()], []).score;       // +50
  const s3 = evidenceQualityScore([ev({ sourceType: 'CUSTOMER' }), oeImage()], [1, 2, 3, 4, 5].map((i) => fx({ fixtureId: `f${i}` }))).score; // +40 +30
  assert.equal(s0, 0);
  assert.equal(s1, 10);
  assert.equal(s2, 60);
  assert.equal(s3, 130);
  assert.ok(s0 <= s1 && s1 <= s2 && s2 <= s3, 'monotont økende');

  // REJECTED endrer ingenting — historisk evidens reduseres aldri.
  const sBefore = evidenceQualityScore([oeImage()], []).score;
  const sAfter = evidenceQualityScore([oeImage(), oeImage({ id: 'oe2', status: 'REJECTED' })], []).score;
  assert.equal(sAfter, sBefore);
});

test('C8.4-9: OE lest av kunde (ikke bilde) gir +10, ikke +50', () => {
  const r = evidenceQualityScore([ev({ evidenceType: 'OE', sourceType: 'CUSTOMER', value: '7H0845101H', createdBy: 'customer' })], []);
  assert.equal(r.score, 10, 'kunde-lesning av OE = kunde-bekreftelse, ikke OE-bilde');
});

test('C8.4-10: explainQualityScore — strukturert forklaring med ✓/✗', () => {
  const events = [oeImage(), ev({ sourceType: 'CUSTOMER', evidenceType: 'CAMERA' })];
  const fixtures = [1, 2, 3, 4, 5, 6, 7].map((i) => fx({ fixtureId: `f${i}` }));
  const r = evidenceQualityScore(events, fixtures);
  const e = explainQualityScore(r);
  assert.equal(e.score, 130);
  assert.ok(e.bekreftet.some((l) => /OE 7H0845101H/.test(l)), 'OE-linje med nummer');
  assert.ok(e.bekreftet.some((l) => /Montørinstallasjon/.test(l)));
  assert.ok(e.manglende.some((l) => /fysisk/.test(l)), 'ekspert fysisk kontroll vises som manglende');
  assert.match(e.tekst, /130\/150/);
});

test('C8.4-11: explainQualityScore på eliminert kandidat', () => {
  const r = evidenceQualityScore([oeImage()], [fx({ outcome: 'WRONG_GLASS' })]);
  const e = explainQualityScore(r);
  assert.match(e.tekst, /eliminert/i);
  assert.equal(e.score, 0);
});
