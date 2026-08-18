/**
 * C9 — Exact Glass Optimization Engine-tester: question optimizer + 1000-søk-måling.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { rankQuestions, optimalQuestionOrder, rankedEvidenceRequests } from '../src/fitment-v1/question-optimizer.js';
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
