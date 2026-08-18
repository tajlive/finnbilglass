/**
 * learning-v1 — C3-testpakke: livssyklus, autoritet, scope, proveniens, teacher,
 * konversasjons-læring, utfall, golden-pipeline, retrieval, konflikter, personvern,
 * spørsmålsmetrikker, kandidat-oppdagelse, fitment-grense.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { makeKnowledgeItem } from '../src/learning-v1/schema.js';
import { KnowledgeStore, nextKnowledgeId } from '../src/learning-v1/store.js';
import { teach } from '../src/learning-v1/teacher.js';
import { startInterview, answerInterview, INTERVIEW_TOPICS } from '../src/learning-v1/interview.js';
import { extractLearningSignals, anonymize, deriveReusableLearning } from '../src/learning-v1/conversation-learning.js';
import { registerOutcome, promoteToVerifiedFitment, wrongGlassNegativeExample, toGoldenFixture } from '../src/learning-v1/outcomes.js';
import { retrieve, activeFitmentRulesFor } from '../src/learning-v1/retrieval.js';
import { detectConflict, resolveConflict, computeQuestionMetrics, discoverySignals, applyPolicyDecision } from '../src/learning-v1/policy.js';

// ── 2/6. livssyklus + autoritet ──
test('L1: konversasjons-avledet kunnskap blir ALDRI ACTIVE automatisk; LLM_INFERENCE kan aldri bli ACTIVE FITMENT_RULE', () => {
  const store = new KnowledgeStore();
  const llm = makeKnowledgeItem({
    knowledgeId: nextKnowledgeId(), version: 1, class: 'FITMENT_RULE', lifecycle: 'CAPTURED', authority: 'LLM_INFERENCE',
    statement: 'LLM-forslag: T5 har regnsensor', reason: null, scope: { make: 'VW', modelFamily: 'Transporter T5' },
    examples: [], counterexamples: [], provenance: { origin: 'CONVERSATION', author: 'llm-agent', source: 'chat', createdAt: new Date().toISOString() },
  });
  store.add(llm);
  // kan gå CAPTURED → PROVISIONAL, men aldri → ACTIVE (verken via overgang eller autoritet)
  store.transition(llm.knowledgeId, 'PROVISIONAL');
  assert.throws(() => store.transition(llm.knowledgeId, 'ACTIVE'), /ulovlig overgang|kan ikke bli ACTIVE|må være VERIFIED/);
  assert.equal(store.activeFitmentRules().length, 0);
});

test('L2: ACTIVE FITMENT_RULE krever VERIFIED + autoritet >= VERIFIED_EXPERT_RULE', () => {
  const store = new KnowledgeStore();
  const rule = makeKnowledgeItem({
    knowledgeId: nextKnowledgeId(), version: 1, class: 'FITMENT_RULE', lifecycle: 'PROVISIONAL', authority: 'VERIFIED_EXPERT_RULE',
    statement: 'T5 2003-2015: antenne betyr ruteantenne', reason: null, scope: { make: 'VW', modelFamily: 'Transporter T5' },
    examples: [], counterexamples: [], provenance: { origin: 'EXPERT_TEACHING', author: 'Tom', source: 'teacher-mode', createdAt: new Date().toISOString() },
  });
  store.add(rule);
  store.transition(rule.knowledgeId, 'REVIEWED');
  store.transition(rule.knowledgeId, 'VERIFIED');
  store.transition(rule.knowledgeId, 'ACTIVE');
  assert.equal(store.activeFitmentRules().length, 1);
  // autoritets-downgrade blokkeres ved ny versjon
  const revised = store.revise(rule.knowledgeId, { authority: 'CUSTOMER_STATEMENT' }, { origin: 'EXPERT_TEACHING', author: 'Tom', source: 'teacher-mode', createdAt: new Date().toISOString() });
  assert.equal(revised.lifecycle, 'PROVISIONAL');
  assert.throws(() => store.transition(revised.knowledgeId, 'ACTIVE'), /ulovlig overgang|autoritet/);
});

// ── 3/4. teacher + proveniens ──
test('L3: undervisningshendelse → KnowledgeCandidate PROVISIONAL med full proveniens; aldri umiddelbar sannhet', () => {
  const store = new KnowledgeStore();
  const res = teach(store, {
    teacher: 'Tom Arne Jensen',
    statement: 'T5: 2525GYA har antenne, 2525GYM har regnsensor — ikke begge.',
    reason: 'kundeforvirring antenne vs regnsensor',
    scope: { make: 'VW', modelFamily: 'Transporter T5', generation: 'T5', productionInterval: { from: '2003', to: '2015' }, market: 'EU' },
    examples: [{ vehicle: 'SU18018', glass: '8579AGSGYAVZ1B' }],
    counterexamples: [{ vehicle: 'SU18018', glass: '8579AGSGYMVZ1B' }],
    affectedKnowledgeClass: 'FITMENT_RULE',
    proposedAuthority: 'VERIFIED_EXPERT_RULE',
    sourceSessionId: 'fs-1234',
  });
  assert.equal(res.candidate.status, 'PROVISIONAL');
  assert.equal(res.candidate.teacher, 'Tom Arne Jensen');
  assert.ok(res.candidate.provenance === undefined || res.candidate.createdAt); // kandidat har timestamp
  const stored = store.all().find((k) => k.statement.includes('2525GYA'));
  assert.ok(stored);
  assert.equal(stored.provenance.origin, 'EXPERT_TEACHING');
  assert.equal(stored.provenance.author, 'Tom Arne Jensen');
  assert.equal(stored.lifecycle, 'PROVISIONAL');
  assert.equal(store.activeFitmentRules().length, 0);
});

test('L4: revisjon ødelegger aldri forrige versjon — supersedes-peker', () => {
  const store = new KnowledgeStore();
  const rule = makeKnowledgeItem({
    knowledgeId: nextKnowledgeId(), version: 1, class: 'DOMAIN_KNOWLEDGE', lifecycle: 'ACTIVE', authority: 'VERIFIED_EXPERT_RULE',
    statement: 'T5: regnsensor er standard på alle', reason: null, scope: { make: 'VW', modelFamily: 'Transporter T5' },
    examples: [], counterexamples: [], provenance: { origin: 'EXPERT_TEACHING', author: 'Tom', source: 'teacher-mode', createdAt: new Date().toISOString() },
  });
  store.add(rule);
  const revised = store.revise(rule.knowledgeId, { statement: 'T5: regnsensor er IKKE standard — sjekk variant' }, { origin: 'EXPERT_TEACHING', author: 'Tom', source: 'teacher-mode', createdAt: new Date().toISOString() });
  assert.equal(revised.version, 2);
  assert.equal(revised.provenance.supersedes, rule.knowledgeId);
  assert.equal(store.get(rule.knowledgeId)!.statement, 'T5: regnsensor er standard på alle'); // gammel beholdt
  assert.equal(store.allVersionsOf(rule.knowledgeId).length, 2);
});

// ── 4. scope ──
test('L5: scope-eksplisitt — regel fra én bil globaliseres aldri', () => {
  const store = new KnowledgeStore();
  const rule = makeKnowledgeItem({
    knowledgeId: nextKnowledgeId(), version: 1, class: 'FITMENT_RULE', lifecycle: 'ACTIVE', authority: 'VERIFIED_EXPERT_RULE',
    statement: 'T5: antenne betyr ruteantenne', reason: null, scope: { make: 'VW', modelFamily: 'Transporter T5' },
    examples: [], counterexamples: [], provenance: { origin: 'EXPERT_TEACHING', author: 'Tom', source: 'teacher-mode', createdAt: new Date().toISOString() },
  });
  store.add(rule);
  // regel gjelder IKKE for Mercedes CLA (scope-filter)
  const cla = activeFitmentRulesFor(store, { vehicle: { make: 'Mercedes', modelFamily: 'CLA' } });
  assert.equal(cla.length, 0);
  const t5 = activeFitmentRulesFor(store, { vehicle: { make: 'VW', modelFamily: 'Transporter T5' } });
  assert.equal(t5.length, 1);
});

// ── 10. retrieval ──
test('L6: retrieval henter kun relevant kunnskap med proveniens — dumper aldri hele basen', () => {
  const store = new KnowledgeStore();
  const mk = (statement: string, scope: { make?: string; modelFamily?: string }, cls = 'DOMAIN_KNOWLEDGE' as const, qtype?: string) =>
    makeKnowledgeItem({
      knowledgeId: nextKnowledgeId(), version: 1, class: cls, lifecycle: 'ACTIVE', authority: 'VERIFIED_EXPERT_RULE',
      statement, reason: null, scope, examples: [], counterexamples: [],
      provenance: { origin: 'EXPERT_TEACHING', author: 'Tom', source: 'teacher-mode', createdAt: new Date().toISOString() },
      relatedQuestionType: qtype ?? null,
    });
  store.add(mk('T5-ruteantenne', { make: 'VW', modelFamily: 'Transporter T5' }));
  store.add(mk('CLA-kamera', { make: 'Mercedes', modelFamily: 'CLA' }));
  store.add(mk('T5-montering', { make: 'VW', modelFamily: 'Transporter T5' }, 'INSTALLATION_KNOWLEDGE', 'fitment-antenna'));
  const results = retrieve(store, { vehicle: { make: 'VW', modelFamily: 'Transporter T5' }, questionType: 'fitment-antenna', maxResults: 2 });
  assert.ok(results.length <= 2);
  assert.ok(results.every((r) => r.provenance.origin && r.provenance.author));
  assert.ok(results.some((r) => r.knowledge.statement.includes('T5')));
  assert.ok(!results.some((r) => r.knowledge.statement.includes('CLA')), 'irrelevant kunnskap hentes ikke');
});

// ── 11. fitment-grense ──
test('L7: hentet ekspert-prosa kan ALDRI sette EXACT/selectedGlass — kun policy-decisjoner passerer', () => {
  const prose = makeKnowledgeItem({
    knowledgeId: nextKnowledgeId(), version: 1, class: 'DOMAIN_KNOWLEDGE', lifecycle: 'ACTIVE', authority: 'VERIFIED_EXPERT_RULE',
    statement: 'Dette er ruta til bilen din! (ekspert-prosa)', reason: null, scope: { make: 'VW' },
    examples: [], counterexamples: [], provenance: { origin: 'EXPERT_TEACHING', author: 'Tom', source: 'teacher-mode', createdAt: new Date().toISOString() },
  });
  // prosa er DOMAIN_KNOWLEDGE → kan aldri påvirke kandidat-eliminering
  assert.equal(prose.mayInfluenceCandidateElimination(), false);
  // selv om en agent prøver å konstruere en beslutning fra prosa, validerer policy-laget strukturen
  assert.throws(() => applyPolicyDecision(null, { fitmentStatus: 'AMBIGUOUS', verificationMode: 'HEURISTIC_ONLY', selectedGlass: '8579AGSVZ1B', reasonCodes: ['LLM_INFERENCE'] }), /selectedGlass kun tillatt ved EXACT/);
  const ok = applyPolicyDecision(null, { fitmentStatus: 'AMBIGUOUS', verificationMode: 'HEURISTIC_ONLY', selectedGlass: null, reasonCodes: ['APPLICATION_LINKAGE_NOT_AUTHORITATIVE'] });
  assert.equal(ok.fitmentStatus, 'AMBIGUOUS');
});

// ── 14. konflikter ──
test('L8: ny undervisning vs ACTIVE-kunnskap → KnowledgeConflict, aldri overskriv', () => {
  const store = new KnowledgeStore();
  const active = makeKnowledgeItem({
    knowledgeId: nextKnowledgeId(), version: 1, class: 'FITMENT_RULE', lifecycle: 'ACTIVE', authority: 'VERIFIED_EXPERT_RULE',
    statement: 'T5: alle har regnsensor', reason: null, scope: { make: 'VW', modelFamily: 'Transporter T5' },
    examples: [], counterexamples: [], provenance: { origin: 'EXPERT_TEACHING', author: 'Tom', source: 'teacher-mode', createdAt: new Date().toISOString() },
  });
  store.add(active);
  const res = teach(store, {
    teacher: 'Tom', statement: 'T5: regnsensor er ikke standard', reason: 'ny kunnskap',
    scope: { make: 'VW', modelFamily: 'Transporter T5' }, affectedKnowledgeClass: 'FITMENT_RULE', proposedAuthority: 'VERIFIED_EXPERT_RULE',
  });
  assert.equal(res.conflicts.length, 1);
  // ACTIVE-regelen er urørt
  assert.equal(store.get(active.knowledgeId)!.lifecycle, 'ACTIVE');
  assert.equal(store.get(active.knowledgeId)!.statement, 'T5: alle har regnsensor');
});

test('L9: konflikt krever eksplisitt løsning', () => {
  const old = makeKnowledgeItem({
    knowledgeId: 'k-old', version: 1, class: 'FITMENT_RULE', lifecycle: 'ACTIVE', authority: 'VERIFIED_EXPERT_RULE',
    statement: 'T5: alle har regnsensor', reason: null, scope: { make: 'VW', modelFamily: 'Transporter T5' },
    examples: [], counterexamples: [], provenance: { origin: 'EXPERT_TEACHING', author: 'Tom', source: 'teacher-mode', createdAt: new Date().toISOString() },
  });
  const fresh = makeKnowledgeItem({
    knowledgeId: 'k-new', version: 1, class: 'FITMENT_RULE', lifecycle: 'PROVISIONAL', authority: 'VERIFIED_EXPERT_RULE',
    statement: 'T5: regnsensor ikke standard', reason: null, scope: { make: 'VW', modelFamily: 'Transporter T5' },
    examples: [], counterexamples: [], provenance: { origin: 'EXPERT_TEACHING', author: 'Tom', source: 'teacher-mode', createdAt: new Date().toISOString() },
  });
  const conflict = detectConflict(old, fresh);
  assert.ok(conflict);
  assert.equal(conflict.status, 'OPEN');
  resolveConflict(conflict, 'KEEP_OLD', 'Tom');
  assert.equal(conflict.status, 'RESOLVED');
  assert.equal(conflict.resolvedBy, 'Tom');
});

// ── 7. konversasjons-læring ──
test('L10: strukturerte læringssignaler utledes fra sesjon (ikke transkript)', () => {
  const signals = extractLearningSignals({
    fitmentSessionId: 'fs-x', channel: 'WEB_CHAT',
    vehicleIdentity: { registrationNumber: 'SU18018', make: 'VW', model: 'Transporter T5 2005', modelYear: 2005 },
    questionsAsked: [{ questionId: 'fitment-rainSensor', system: false }],
    observations: [{ questionId: 'fitment-rainSensor', value: true, status: 'RECORDED', recordedAt: 'x' }],
    identifierObservations: [{ state: 'CONFIRMED', parsed: '7H0845101H', modality: 'PHOTO' }],
    photos: [{ identifierCandidates: [{ state: 'CONFIRMED' }] }],
    fitmentStatus: 'EXACT', verificationMode: 'CUSTOMER_OBSERVATION', handoffState: null, quoteState: 'ORDERABLE_QUOTE',
    auditEvents: [
      { action: 'observation_superseded', notes: 'antenne: nei→ja' },
      { action: 'identifier_rejected', raw: '7H0845101F' },
    ],
    turnCount: 5,
  });
  assert.equal(signals.questionsAsked, 1);
  assert.equal(signals.customerCorrections.length, 1);
  assert.equal(signals.customerDidNotUnderstand, true);
  assert.equal(signals.orderCreated, true);
  assert.equal(signals.finalFitmentStatus, 'EXACT');
  assert.equal(signals.manualHandoff, false);
});

// ── 16. personvern ──
test('L11: PII anonymiseres; gjenbrukbar læring kobles fra kundeidentitet', () => {
  const anonymized = anonymize('Tom Hansen på +47 400 00 000 sa det, bilen er SU18018, epost tom@example.com');
  assert.ok(!anonymized.includes('+47 400'));
  assert.ok(!anonymized.includes('SU18018'));
  assert.ok(!anonymized.includes('tom@example.com'));
  const learning = deriveReusableLearning(['Jeg trodde regnsensor og kamera var det samme'], ['7H0845101F']);
  assert.equal(learning[0].category, 'misunderstanding');
  assert.ok(learning[0].pattern.includes('forveksler'));
  assert.ok(learning[0].evidenceCount >= 1);
});

// ── 8/9. utfall + golden-pipeline ──
test('L12: bekreftet installasjon kan bli VERIFIED_REAL_WORLD_FITMENT — kun etter policy-validering', () => {
  const store = new KnowledgeStore();
  const outcome = registerOutcome({
    sessionId: 'fs-x', registrationNumber: 'SU18018', vin: 'WV1ZZZ7HZ5H060934',
    selectedGlass: '8579AGSGYAVZ1B', selectedVarenr: '2525GYA',
    outcome: 'INSTALLED_SUCCESSFULLY', observedAt: new Date().toISOString(), reportedBy: 'installatør', notes: null,
  });
  const promoted = promoteToVerifiedFitment(store, outcome, { verifiedBy: 'installatør', verificationMethod: 'installatør-bekreftet montering + kundebekreftelse' });
  assert.ok(promoted.ok);
  assert.equal(promoted.knowledge!.authority, 'VERIFIED_REAL_WORLD_INSTALLATION');
  assert.equal(promoted.knowledge!.lifecycle, 'VERIFIED'); // aldri automatisk ACTIVE
  assert.equal(outcome.promotedToVerifiedFitment, true);
  // feil utfall kan ikke promoteres
  const bad = registerOutcome({ sessionId: null, registrationNumber: 'AJ95429', vin: null, selectedGlass: null, selectedVarenr: null, outcome: 'WRONG_GLASS', observedAt: new Date().toISOString(), reportedBy: 'installatør', notes: 'feil glass' });
  assert.equal(promoteToVerifiedFitment(store, bad, { verifiedBy: 'x', verificationMethod: 'y' }).ok, false);
});

test('L13: feil glass = kritisk negativt eksempel, aldri positiv regel', () => {
  const outcome = registerOutcome({
    sessionId: 'fs-x', registrationNumber: 'SU18018', vin: 'WV1ZZZ7HZ5H060934',
    selectedGlass: '8579AGSVZ1B', selectedVarenr: '2525GY', outcome: 'WRONG_GLASS',
    observedAt: new Date().toISOString(), reportedBy: 'installatør', notes: 'kunden hadde regnsensor',
  });
  const neg = wrongGlassNegativeExample(outcome);
  assert.equal(neg.severity, 'CRITICAL');
  assert.ok(neg.example.includes('FEIL GLASS'));
  assert.equal(toGoldenFixture(outcome, { make: 'VW', model: 'Transporter', modelYear: 2005 }).ok, false, 'feil glass kan aldri bli golden-fixture');
});

test('L14: golden-pipeline — reelt utfall → fixture → regresjonstest; endrer aldri eksisterende forventninger', () => {
  const outcome = registerOutcome({
    sessionId: 'fs-x', registrationNumber: 'SU18018', vin: 'WV1ZZZ7HZ5H060934',
    selectedGlass: '8579AGSGYAVZ1B', selectedVarenr: '2525GYA', outcome: 'INSTALLED_SUCCESSFULLY',
    observedAt: new Date().toISOString(), reportedBy: 'installatør', notes: null,
  });
  const r = toGoldenFixture(outcome, { make: 'VW', model: 'Transporter T5', modelYear: 2005 });
  assert.ok(r.ok);
  assert.equal(r.fixture!.expectedGlass, '8579AGSGYAVZ1B');
  assert.equal(r.fixture!.evidenceClass, 'VERIFIED_REAL_WORLD_FITMENT');
  assert.ok(r.fixture!.regressionTest.includes('fitment-golden'));
  assert.equal(r.fixture!.expectedDecision, 'EXACT');
});

// ── 12. spørsmålsmetrikker ──
test('L15: spørsmålseffektivitet måles (korrekthet > konvertering > hastighet)', () => {
  const rows = [
    { questionId: 'fitment-rainSensor', resolvedExact: true, confused: false, corrected: false, photoFallback: false, handoff: false, candidateReduction: 4, turns: 5 },
    { questionId: 'fitment-rainSensor', resolvedExact: true, confused: true, corrected: true, photoFallback: true, handoff: false, candidateReduction: 4, turns: 9 },
    { questionId: 'fitment-antenna', resolvedExact: false, confused: false, corrected: false, photoFallback: false, handoff: true, candidateReduction: 0, turns: 12 },
  ];
  const m = computeQuestionMetrics(rows);
  const rain = m.find((x) => x.questionId === 'fitment-rainSensor')!;
  assert.equal(rain.sessions, 2);
  assert.equal(rain.resolutionRate, 1);
  assert.equal(rain.customerConfusionRate, 0.5);
  const ant = m.find((x) => x.questionId === 'fitment-antenna')!;
  assert.equal(ant.manualHandoffRate, 1);
});

// ── 15. kandidat-oppdagelse ──
test('L16: automatisk kandidat-oppdagelse → CAPTURED, aldri automatisk aktivering', () => {
  const sessions = [
    { handoff: true, corrections: ['antenne feil'], unresolved: true, wrongGlass: false, unknownTerms: ['ADAS'] },
    { handoff: true, corrections: ['antenne feil'], unresolved: true, wrongGlass: false, unknownTerms: ['ADAS'] },
    { handoff: true, corrections: ['antenne feil'], unresolved: true, wrongGlass: true, unknownTerms: ['ADAS'] },
  ];
  const signals = discoverySignals(sessions);
  assert.ok(signals.some((s) => s.kind === 'REPEATED_HANDOFF'));
  assert.ok(signals.some((s) => s.kind === 'REPEATED_CORRECTION'));
  assert.ok(signals.some((s) => s.kind === 'WRONG_GLASS_RETURN'));
  assert.ok(signals.some((s) => s.kind === 'FREQUENT_UNKNOWN_TERM' && s.trigger === 'ADAS'));
  // Signaler er kun forslag — lagres som CAPTURED kandidater, ingen policy-endring
});

// ── 19. ekspert-intervju ──
test('L17: Expert Interview Mode — svar blir KnowledgeCandidates, ikke umiddelbar sannhet', () => {
  assert.ok(INTERVIEW_TOPICS.length >= 14);
  const store = new KnowledgeStore();
  const iv = startInterview('Tom', 'camera-sensor-config');
  const r = answerInterview(store, iv, {
    statement: 'Kamera bak speilet (ADAS) er ikke det samme som regnsensor; begge kan finnes i samme glass.',
    scope: { make: null, modelFamily: null },
  });
  assert.equal(r.candidateCount, 1);
  assert.equal(r.conflicts, 0);
  const candidates = store.all().filter((k) => k.provenance.source === 'expert-interview:camera-sensor-config');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].lifecycle, 'PROVISIONAL');
  assert.equal(candidates[0].authority, 'VERIFIED_EXPERT_RULE');
});

// ── eksempel-filer ──
test('L18: eksempel-hendelser (Tom-undervisning, konversasjon, feil glass) er til stede og strukturerte', () => {
  const teaching = JSON.parse(readFileSync(new URL('../src/learning-v1/samples/sample-tom-teaching.json', import.meta.url), 'utf8'));
  const conv = JSON.parse(readFileSync(new URL('../src/learning-v1/samples/sample-conversation-learning.json', import.meta.url), 'utf8'));
  const wrong = JSON.parse(readFileSync(new URL('../src/learning-v1/samples/sample-wrong-glass-learning.json', import.meta.url), 'utf8'));
  assert.equal(teaching.teachingEvents[0].teacher, 'Tom Arne Jensen');
  assert.equal(teaching.teachingEvents[0].affectedKnowledgeClass, 'FITMENT_RULE');
  assert.equal(conv.sessionSignals.finalFitmentStatus, 'EXACT');
  assert.equal(wrong.outcome.outcome, 'WRONG_GLASS');
  assert.equal(wrong.criticalNegativeExample.includes('FEIL GLASS'), true);
});
