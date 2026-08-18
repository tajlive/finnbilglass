/**
 * C10 — Glass Knowledge Graph Phase 1 (VW Transporter T5/T6 vertical slice).
 * Aksept: SU18018 + OE 7H0845101H → EXACT 2525GYA med komplett beviskjede.
 * Regler: replay-determinisme · ingen evidens = aldri EXACT · WRONG_GLASS eliminerer · append-only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traverseKnowledgeGraph, materializeProjections } from '../src/learning-v1/knowledge-graph.js';

function ev(over = {}) {
  return { id: 'e1', vehicleIdentityHash: 'acf436c279ef', registrationHash: null, createdAt: 1750000000000, sourceType: 'CUSTOMER', evidenceType: 'CAMERA', value: 'true', confidence: 70, status: 'CONFIRMED', createdBy: 'customer', sessionId: null, candidateVarenr: null, supersedes: null, notes: null, ...over };
}
function fx(over = {}) {
  return { fixtureId: 'f1', vehicleIdentityHash: 'acf436c279ef', candidateVarenr: '2525GYA', eurokode: '2525GYA', outcome: 'INSTALLED_SUCCESSFULLY', installerId: 'montor-1', confirmedAt: 1750000000000, status: 'VERIFIED', sourceOrderId: null, notes: null, ...over };
}
const oeImage = (value, over = {}) => ev({ id: 'oe1', evidenceType: 'OE', sourceType: 'OE_IMAGE', value, createdBy: 'installer', status: 'VERIFIED', ...over });

const vehicle = { identityHash: 'acf436c279ef', registrationNumber: 'SU18018', make: 'VW', model: 'Transporter', generation: 'T5', modelYear: 2005 };
const candidates = [
  { eurocode: '2525GYA', varenr: '2525GYA', features: ['camera', 'rainSensor'], oes: ['7H0845101H'] },
  { eurocode: '2525GYM', varenr: '2525GYM', features: [], oes: ['7H0845101F'] },
  { eurocode: '2525GY', varenr: '2525GY', features: [], oes: ['7E0845099H'] },
];

test('C10-1 (aksept): SU18018 + OE 7H0845101H → EXACT 2525GYA, score 130/150, øvrige eliminert', () => {
  const events = [oeImage('7H0845101H'), ev({ sourceType: 'CUSTOMER', evidenceType: 'CAMERA' })];
  const fixtures = [1, 2, 3, 4, 5, 6, 7].map((i) => fx({ fixtureId: `f${i}`, installerId: `montor-${i}` }));
  const r = traverseKnowledgeGraph({ vehicle, candidates, events, fixtures });

  assert.equal(r.fitmentStatus, 'EXACT');
  assert.equal(r.selectedGlass, '2525GYA');
  assert.equal(r.selectedVarenr, '2525GYA');
  assert.equal(r.qualityScore, 130, 'OE +50, montør +40, 5+ +30, kunde +10 = 130');
  assert.equal(r.eliminations.length, 2, '2525GYM og 2525GY elimineres av OE-mismatch');
  assert.ok(r.eliminations.every((e) => /OE 7H0845101H/.test(e.reason)));
  assert.match(r.explanation, /EXACT/);
  assert.match(r.explanation, /2525GYA/);
  assert.match(r.explanation, /130\/150/);
  assert.match(r.explanation, /7 vellykkede installasjon/);
  assert.match(r.explanation, /Eliminerte kandidater/);
});

test('C10-2: replay-determinisme — samme input gir identisk output', () => {
  const events = [oeImage('7H0845101H'), ev({ sourceType: 'CUSTOMER', evidenceType: 'CAMERA' })];
  const fixtures = [1, 2, 3].map((i) => fx({ fixtureId: `f${i}` }));
  const a = traverseKnowledgeGraph({ vehicle, candidates, events, fixtures });
  const b = traverseKnowledgeGraph({ vehicle, candidates, events, fixtures });
  assert.deepEqual(a, b);
});

test('C10-3: ingen evidens = aldri EXACT (3 kandidater → AMBIGUOUS)', () => {
  const r = traverseKnowledgeGraph({ vehicle, candidates, events: [], fixtures: [] });
  assert.notEqual(r.fitmentStatus, 'EXACT');
  assert.equal(r.fitmentStatus, 'AMBIGUOUS');
  assert.equal(r.selectedGlass, null);
});

test('C10-4: én kandidat uten evidens = UNKNOWN (én kandidat ≠ bevis)', () => {
  const r = traverseKnowledgeGraph({ vehicle, candidates: [candidates[0]], events: [], fixtures: [] });
  assert.equal(r.fitmentStatus, 'UNKNOWN', 'katalog alene kan aldri gi EXACT');
  assert.equal(r.selectedGlass, null);
});

test('C10-5: WRONG_GLASS eliminerer kandidaten', () => {
  const events = [oeImage('7H0845101H')];
  const fixtures = [fx({ fixtureId: 'wrong1', outcome: 'WRONG_GLASS' })];
  const r = traverseKnowledgeGraph({ vehicle, candidates, events, fixtures });
  const resolved = r.candidates.find((c) => c.eurocode === '2525GYA');
  assert.equal(resolved.eliminated, true);
  assert.match(resolved.eliminateReason, /WRONG_GLASS/);
  assert.equal(r.fitmentStatus, 'UNKNOWN', 'riktig kandidat eliminert → ingen EXACT');
});

test('C10-6: OE-observasjon fra kunde (ikke bilde) gir lavere score, men installasjoner kan fortsatt gi EXACT', () => {
  const events = [ev({ evidenceType: 'OE', sourceType: 'CUSTOMER', value: '7H0845101H', createdBy: 'customer', status: 'CONFIRMED' })];
  const fixtures = [1, 2, 3, 4, 5].map((i) => fx({ fixtureId: `f${i}` }));
  const r = traverseKnowledgeGraph({ vehicle, candidates, events, fixtures });
  // OE fra kunde = +10 (ikke +50), men 5 installasjoner (≥3) gir fortsatt autoritativ evidens.
  assert.equal(r.fitmentStatus, 'EXACT');
  const resolved = r.candidates.find((c) => c.eurocode === '2525GYA');
  assert.equal(resolved.quality.score, 80, 'OE-kunde +10, montør +40, 5+ +30 = 80');
});

test('C10-7: append-only — traversering/materialisering muterer aldri input', () => {
  const events = [oeImage('7H0845101H'), ev({ sourceType: 'CUSTOMER', evidenceType: 'CAMERA' })];
  const fixtures = [fx(), fx({ fixtureId: 'f2', installerId: 'montor-2' })];
  const eventsSnap = JSON.stringify(events);
  const fixturesSnap = JSON.stringify(fixtures);
  traverseKnowledgeGraph({ vehicle, candidates, events, fixtures });
  materializeProjections(events, fixtures);
  assert.equal(JSON.stringify(events), eventsSnap, 'events uendret');
  assert.equal(JSON.stringify(fixtures), fixturesSnap, 'fixtures uendret');
});

test('C10-8: materialisering — ledger projiseres til glass_*-noder (glass_* = kun projeksjon)', () => {
  const events = [oeImage('7H0845101H'), ev({ evidenceType: 'CAMERA' })];
  const fixtures = [fx(), fx({ fixtureId: 'f2' }), fx({ fixtureId: 'f3' })];
  const p = materializeProjections(events, fixtures);

  assert.equal(p.glassEvidence.length, 2, 'OE + CAMERA = 2 evidensnoder');
  assert.equal(p.glassFeatures.length, 1, 'kun CAMERA (ikke OE) blir feature');
  assert.equal(p.glassVehicleLinks.length, 1);
  const link = p.glassVehicleLinks[0];
  assert.equal(link.installations, 3);
  assert.equal(link.confidence, 90, '≥3 korroberte installasjoner → VERIFIED_REAL_WORLD_INSTALLATION (90)');
});

test('C10-9: materialisering ignorerer AI- og REJECTED-evidens (aldri sannhet)', () => {
  const p = materializeProjections([oeImage('7H0845101H', { createdBy: 'ai' }), ev({ status: 'REJECTED' })], []);
  assert.equal(p.glassEvidence.length, 0, 'AI + REJECTED projiseres ikke som sannhet');
});
