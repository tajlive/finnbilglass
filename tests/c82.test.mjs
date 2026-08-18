/**
 * C8.2 — Evidence Analytics-tester.
 * «Gjør læringen målbar — da vet C9.5 hvor den skal lete.»
 * Læringsscore = markedsvolum × manuell-gap × evidence-mangel.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { learningOpportunities, confidenceFor } from '../src/learning-v1/analytics.js';

function v(over) { return { make: 'VW', model: 'GOLF', year: 2018, familie: 'GOLF', kandidater: 5, skillendeFeatures: ['acoustic', 'camera'], ...over }; }

test('C8.2-1: læringsscore rangerer etter markedsvolum × manuell-gap × evidence-mangel', () => {
  const opp = learningOpportunities(
    [
      v({ familie: 'MODEL-Y', sok: 0, kandidater: 0, skillendeFeatures: [] }),
      v({ familie: 'GOLF', kandidater: 5, skillendeFeatures: ['acoustic'] }),
    ],
    { 'MODEL-Y': 3500, GOLF: 100 },
    {},
  );
  const my = opp.find((o) => o.familie === 'MODEL-Y');
  const golf = opp.find((o) => o.familie === 'GOLF');
  assert.ok(my && golf);
  // MODEL-Y: 3500 × 1.0 (100 % manuell) > GOLF: 100 × 0.0 (0 % manuell) — selv med features-mangel
  assert.ok(my.læringsscore > golf.læringsscore, 'høyt markedsvolum + fullt manuell-gap må rangere øverst');
  assert.ok(golf.læringsscore > 0, 'features-mangel må gi læringsscore > 0');
});

test('C8.2-2: manglende features er skillende features UTEN lagret evidens (harEvidens filtrerer)', () => {
  const oppUten = learningOpportunities([v({ skillendeFeatures: ['acoustic', 'camera'] })], { GOLF: 100 }, {});
  assert.deepEqual(oppUten[0].manglendeFeatures, ['acoustic', 'camera']);
  const oppMed = learningOpportunities([v({ skillendeFeatures: ['acoustic', 'camera'] })], { GOLF: 100 }, {}, (fam, f) => f === 'camera');
  assert.deepEqual(oppMed[0].manglendeFeatures, ['acoustic'], 'kamera-evidence finnes → bare acoustic mangler');
});

test('C8.2-3: anbefalingen skiller kandidatgenerering (C9.5) fra evidenssamling (C8)', () => {
  const opp = learningOpportunities(
    [
      v({ familie: 'LEAF', kandidater: 0, skillendeFeatures: [] }),
      v({ familie: 'TRANSPORTER', kandidater: 6, skillendeFeatures: ['rainSensor'] }),
    ],
    { LEAF: 135, TRANSPORTER: 89 },
    {},
  );
  const leaf = opp.find((o) => o.familie === 'LEAF');
  const t5 = opp.find((o) => o.familie === 'TRANSPORTER');
  assert.match(leaf.anbefaling, /kandidatgenerering|Finn Vehicle Intelligence/);
  assert.match(t5.anbefaling, /evidens|fixtures/);
});

test('C8.2-4: WRONG_GLASS-fixtures teller feilglass; ≥3 korroberte installasjoner = verdifulle fixtures', () => {
  const opp = learningOpportunities(
    [v({ familie: 'GOLF' })],
    { GOLF: 100 },
    { '2525GYA': { installed: 4, wrong: 0 }, '2525GYM': { installed: 0, wrong: 2 } },
  );
  assert.equal(opp[0].verdifulleFixtures, 1, '2525GYA har 4 korroberte installasjoner');
  assert.equal(opp[0].feilglass, 2, '2 WRONG_GLASS på 2525GYM');
});

test('C8.2-6: Learning Opportunity Confidence — aldri overreager på små datasett', () => {
  assert.deepEqual(confidenceFor(78, 0), { confidence: 'LAV', aarsak: 'bare 78 observasjoner' }, 'Toms eksempel: BMW 3-serie 78 obs → lav');
  assert.equal(confidenceFor(111, 0).confidence, 'MIDDELS', 'Golf 111 obs uten installasjoner → middels (ikke høy — ingen korroborert evidens ennå)');
  assert.equal(confidenceFor(400, 12).confidence, 'HØY');
  assert.match(confidenceFor(400, 12).aarsak, /400 observasjoner \+ 12 korroberte/);
  const opp = learningOpportunities([v({ familie: 'GOLF' })], { GOLF: 100 }, { '2525GYA': { installed: 4, wrong: 0 } });
  assert.equal(opp[0].confidence, 'MIDDELS', '111 søk + 4 korroberte → middels');
  assert.ok(opp[0].confidenceAarsak.length > 0);
});

test('C8.2-7: confidenceAarsak er synlig i TOPP-rapporten (rapportering, ikke skjult)', () => {
  execFileSync('node', ['--import', 'tsx', 'scripts/c82-evidence-analytics.mjs'], { cwd: new URL('..', import.meta.url).pathname });
  const rep = JSON.parse(readFileSync(fileURLToPath(new URL('../scripts/out/c82-evidence-analytics.json', import.meta.url)), 'utf8'));
  for (const r of rep.topp) {
    assert.ok(['HØY', 'MIDDELS', 'LAV'].includes(r.confidence), `${r.familie}: gyldig confidence`);
    assert.ok(r.confidenceAarsak.length > 0, `${r.familie}: årsak finnes`);
  }
});
test('C8.2-5: script-integritet — TOPP-listen kommer fra SVV-korpuset, summerer korrekt', () => {
  execFileSync('node', ['--import', 'tsx', 'scripts/c82-evidence-analytics.mjs'], { cwd: new URL('..', import.meta.url).pathname });
  const rep = JSON.parse(readFileSync(fileURLToPath(new URL('../scripts/out/c82-evidence-analytics.json', import.meta.url)), 'utf8'));
  assert.ok(rep.topp.length >= 10, 'TOPP 10-liste');
  assert.ok(rep.meta.korpus > 500, 'SVV-korpus-volum');
  const totalSok = rep.topp.reduce((s, r) => s + r.sok, 0);
  assert.ok(totalSok > 500);
  // Hver familie har konsistent telleføring: sok = manuell + løst
  for (const r of rep.topp) assert.ok(r.manuell <= r.sok, `${r.familie}: manuell ≤ sok`);
  assert.ok(rep.oppsummering.manglendeFeaturesUnike.length >= 1, 'minst én manglende feature kartlagt');
});
