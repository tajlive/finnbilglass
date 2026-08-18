/**
 * C9 — Exact Glass Optimization Engine-tester: question optimizer + 1000-søk-måling.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { rankQuestions, optimalQuestionOrder, rankedEvidenceRequests, FEATURE_COST, FEATURE_ANSWERABILITY } from '../src/fitment-v1/question-optimizer.js';
import { buildEvidenceRequests } from '../src/fitment-v1/differentiation.js';

// Toms eksempel: Glass A (regnsensor+antenne), Glass B (regnsensor), Glass C (ingen)
const tomsEksempel = [
  { varenr: 'A', eurokode: 'A', features: ['rainSensor', 'antenna'] },
  { varenr: 'B', eurokode: 'B', features: ['rainSensor'] },
  { varenr: 'C', eurokode: 'C', features: [] },
];

test('C9-1: question optimizer — maks eliminering først (Toms eksempel)', () => {
  const ranks = rankQuestions(tomsEksempel);
  const rain = ranks.find((r) => r.feature === 'rainSensor');
  const ant = ranks.find((r) => r.feature === 'antenna');
  // Katalogfravær = null (ukjent, elimineres ikke): rainSensor: nei→eliminerer A+B (2) → potensial 2
  // antenna: nei→eliminerer A (1) → potensial 1 → rainSensor spørres FØRST (høyest eliminering)
  assert.equal(rain.potensial, 2);
  assert.equal(ant.potensial, 1);
  const order = optimalQuestionOrder(tomsEksempel);
  assert.deepEqual(order, ['rainSensor', 'antenna']);
  const reqs = rankedEvidenceRequests(tomsEksempel);
  assert.equal(reqs.length, 2);
  assert.deepEqual(reqs.map((r) => r.feature), ['rainSensor', 'antenna']);
});

test('C9-2: spørsmål som eliminerer flest kommer FØRST (potensial desc)', () => {
  const c = [
    { varenr: 'X1', eurokode: 'X1', features: ['heated'] },
    { varenr: 'X2', eurokode: 'X2', features: ['heated'] },
    { varenr: 'X3', eurokode: 'X3', features: [] },
    { varenr: 'X4', eurokode: 'X4', features: [] },
  ];
  // heated: ja→2, nei→2 → potensial 2
  const ranks = rankQuestions(c);
  assert.ok(ranks.length >= 1);
  assert.equal(ranks[0].potensial, 2);
});

test('C9-3: OE-ID prioriteres øverst når den skiller (minimum pålitelig evidens)', () => {
  const medOe = [
    { varenr: 'Y1', eurokode: 'Y1', features: ['rainSensor'], glavista: { oes: ['OE-A'], features: [] } },
    { varenr: 'Y2', eurokode: 'Y2', features: [], glavista: { oes: ['OE-B'], features: [] } },
  ];
  const order = optimalQuestionOrder(medOe);
  assert.equal(order[0], 'OE');
});

test('C9-4: 1000-søk-målingen produserer ærlig fordeling (0 EXACT direkte uten evidens)', () => {
  execFileSync('node', ['--import', 'tsx', 'scripts/c9-accuracy.mjs'], { cwd: new URL('..', import.meta.url).pathname });
  const rep = JSON.parse(readFileSync(new URL('../scripts/out/c9-accuracy.json', import.meta.url), 'utf8'));
  assert.equal(rep.fordeling.EXACT_DIREKTE.antall, 0, 'katalog/CLASS_D alene gir aldri EXACT');
  const total = rep.fordeling.EXACT_DIREKTE.antall + rep.fordeling.ETT_SPORSMAL.antall + rep.fordeling.FOTO_OE.antall + rep.fordeling.HANDOFF.antall;
  assert.equal(total, rep.meta.sok);
  for (const f of rep.perFamilie) {
    const s = f.EXACT_DIREKTE + f.ETT_SPORSMAL + f.FOTO_OE + f.HANDOFF;
    assert.equal(s, f.sok, `summen for ${f.familie} stemmer ikke`);
  }
});

// ── C9.1 Question Intelligence ──
test('C9.1-1: Question Value = eliminering × feilkostnad × svarbarhet (Toms kamera-vs-HUD-eksempel)', () => {
  // Kamera: eliminerer 8/10, svarbarhet 0.95 — HUD: eliminerer 3/10, svarbarhet 0.5
  const kandidater = [];
  for (let i = 0; i < 10; i++) kandidater.push({ varenr: `K${i}`, eurokode: `K${i}`, features: [i < 8 ? 'camera' : null, i < 3 ? 'hud' : null].filter(Boolean) });
  // → camera skiller (8 ja / 2 nei), hud skiller (3 ja / 7 nei)
  const ranks = rankQuestions(kandidater);
  const kamera = ranks.find((r) => r.feature === 'camera');
  const hud = ranks.find((r) => r.feature === 'hud');
  assert.ok(kamera, 'kamera må være informativ');
  assert.ok(hud, 'hud må være informativ');
  assert.equal(kamera.potensial, 8);
  assert.equal(hud.potensial, 3);
  assert.equal(kamera.questionValue, 8 * FEATURE_COST.camera * FEATURE_ANSWERABILITY.camera);
  assert.equal(hud.questionValue, 3 * (FEATURE_COST.hud ?? 0.5) * (FEATURE_ANSWERABILITY.hud ?? 0.5));
  assert.ok(kamera.questionValue > hud.questionValue, 'kamera-spørsmålet må ha høyest verdi');
  assert.equal(optimalQuestionOrder(kandidater)[0], 'camera');
});

test('C9.1-2: svarbarhet-straff — spørsmål kunden sjelden kan svare på nedprioriteres', () => {
  // coated: 2 kandidater med, 2 uten (potensial 2) — kamera: 2 med, 2 uten (potensial 2)
  const kandidater = [
    { varenr: 'a', eurokode: 'a', features: ['coated', 'camera'] },
    { varenr: 'b', eurokode: 'b', features: ['coated', 'camera'] },
    { varenr: 'c', eurokode: 'c', features: [] },
    { varenr: 'd', eurokode: 'd', features: [] },
  ];
  const order = optimalQuestionOrder(kandidater);
  // kamera (svarbarhet 0.95) må komme før coated (svarbarhet 0.4) ved lik eliminering
  assert.equal(order[0], 'camera');
  assert.equal(order[1], 'coated');
});

test('C9.1-3: C9.1-benchmark — 5 klasser, FEILBESTILLING = 0, Safety/Covery-KPI', () => {
  execFileSync('node', ['--import', 'tsx', 'scripts/c91-benchmark.mjs'], { cwd: new URL('..', import.meta.url).pathname });
  const rep = JSON.parse(readFileSync(new URL('../scripts/out/c91-benchmark.json', import.meta.url), 'utf8'));
  const f = rep.fordeling;
  const total = f.EXACT_UTEN_SPORSMAL.antall + f.EXACT_ETTER_AI_SPORSMAL.antall + f.EXACT_ETTER_BILDE_OE.antall + f.MANUELL.antall + f.FEILBESTILLING.antall;
  assert.equal(total, rep.meta.sok, '5 klasser må summere til 1000');
  assert.equal(f.FEILBESTILLING.antall, 0, 'systemet feilbestiller aldri — «jeg vet ikke» er bedre enn feil');
  assert.ok(rep.metrikker.wrong_glass_risk >= 0 && rep.metrikker.wrong_glass_risk <= 100);
  // Safety Accuracy = aldri feilbestilling (100 %); Coverage Accuracy = løst automatisk
  assert.equal(rep.metrikker.safety_accuracy, 100, '0 feil = 100 % safety');
  const coverage = Math.round(((f.EXACT_UTEN_SPORSMAL.antall + f.EXACT_ETTER_AI_SPORSMAL.antall + f.EXACT_ETTER_BILDE_OE.antall) / rep.meta.sok) * 1000) / 10;
  assert.equal(rep.metrikker.coverage_accuracy, coverage);
  assert.ok(rep.metrikker.coverage_accuracy > 0 && rep.metrikker.coverage_accuracy < 100, 'coverage øker via C8-data');
  for (const pf of rep.perFamilie) {
    const s = pf.EXACT_UTEN_SPORSMAL + pf.EXACT_ETTER_AI_SPORSMAL + pf.EXACT_ETTER_BILDE_OE + pf.MANUELL + pf.FEILBESTILLING;
    assert.equal(s, pf.sok, `summen for ${pf.familie} stemmer ikke`);
  }
});
