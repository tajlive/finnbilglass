/**
 * C8.3 — Evidence Dashboard-tester.
 * Kontrollpanel for læringsmotoren — fire styringsspørsmål, alle deterministiske.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { manglendeEvidens, featuresMedFlestSpoersmaal, glassMedMestUsikkerhet, installasjonerMedMestVerdi } from '../src/learning-v1/dashboard.js';

const ROOT = new URL('..', import.meta.url).pathname;

function ev(over = {}) {
  return { evidenceType: 'CAMERA', status: 'CONFIRMED', value: 'true', confidence: 70, createdAt: '2026-08-18', vehicleIdentityHash: 'abc', sourceType: 'CUSTOMER', createdBy: 'customer', candidateVarenr: null, notes: null, ...over };
}
function fx(over = {}) {
  return { fixtureId: 'f1', vehicleIdentityHash: 'abc', candidateVarenr: '2525GYA', outcome: 'INSTALLED_SUCCESSFULLY', installer: 'montor', confirmedAt: '2026-08-18', status: 'VERIFIED', ...over };
}
const input = (events, fixtures, analytics = [], coverage = []) => ({ evidenceEvents: events, fixtures, analytics, coverage });

test('C8.3-1: manglendeEvidens — prioriterer høy læringsscore, viser manglende features og confidence', () => {
  const d = input([], [], [
    { familie: 'TRANSPORTER', sok: 79, manuell: 0, markedsVolum: 89, manglendeFeatures: ['rainSensor', 'antenna'], feilglass: 0, verdifulleFixtures: 0, installasjoner: 0, læringsscore: 44, confidence: 'MIDDELS', confidenceAarsak: '79 observasjoner', anbefaling: 'x' },
    { familie: 'GOLF', sok: 111, manuell: 0, markedsVolum: 100, manglendeFeatures: ['encapsulated'], feilglass: 0, verdifulleFixtures: 0, installasjoner: 0, læringsscore: 30, confidence: 'MIDDELS', confidenceAarsak: '111 observasjoner', anbefaling: 'x' },
  ]);
  const r = manglendeEvidens(d);
  assert.equal(r[0].familie, 'TRANSPORTER', 'høyest læringsscore først');
  assert.deepEqual(r[0].manglendeFeatures, ['rainSensor', 'antenna']);
  assert.equal(r[0].confidence, 'MIDDELS');
});

test('C8.3-2: featuresMedFlestSpoersmaal — teller evidens-type fra ledgeren', () => {
  const d = input([
    ev({ evidenceType: 'CAMERA' }), ev({ evidenceType: 'CAMERA' }), ev({ evidenceType: 'RAIN_SENSOR' }),
  ]);
  const r = featuresMedFlestSpoersmaal(d);
  assert.equal(r[0].feature, 'CAMERA');
  assert.equal(r[0].antall, 2);
});

test('C8.3-3: glassMedMestUsikkerhet — flest skillende features + lavest confidence øverst', () => {
  const d = input([], [], [
    { familie: 'GOLF', sok: 111, manuell: 0, markedsVolum: 100, manglendeFeatures: ['encapsulated'], feilglass: 0, verdifulleFixtures: 0, installasjoner: 0, læringsscore: 30, confidence: 'LAV', confidenceAarsak: 'x', anbefaling: 'x' },
    { familie: 'TRANSPORTER', sok: 79, manuell: 0, markedsVolum: 89, manglendeFeatures: ['rainSensor', 'antenna', 'coated'], feilglass: 0, verdifulleFixtures: 0, installasjoner: 0, læringsscore: 44, confidence: 'MIDDELS', confidenceAarsak: 'x', anbefaling: 'x' },
    { familie: 'LEAF', sok: 94, manuell: 0, markedsVolum: 135, manglendeFeatures: [], feilglass: 0, verdifulleFixtures: 0, installasjoner: 0, læringsscore: 10, confidence: 'HØY', confidenceAarsak: 'x', anbefaling: 'x' },
  ]);
  const r = glassMedMestUsikkerhet(d);
  assert.equal(r[0].familie, 'TRANSPORTER', '3 skillende features slår 1');
  assert.equal(r.length, 2, 'LEAF uten manglende features er ikke usikker');
});

test('C8.3-4: installasjonerMedMestVerdi — korroberte installasjoner × markedsvolum, feil trekker ned', () => {
  const d = input([], [
    fx({ candidateVarenr: '2525GYA', outcome: 'INSTALLED_SUCCESSFULLY' }),
    fx({ candidateVarenr: '2525GYA', outcome: 'INSTALLED_SUCCESSFULLY' }),
    fx({ candidateVarenr: '2525GYM', outcome: 'WRONG_GLASS' }),
  ]);
  const r = installasjonerMedMestVerdi(d, { '2525GYA': 89, '2525GYM': 89 });
  assert.equal(r[0].varenr, '2525GYA', '2 installasjoner × 89 volum = 178 > feilbestilling -10');
  assert.equal(r[0].installed, 2);
  assert.equal(r[1].wrong, 1);
});

test('C8.3-5: script-integritet — dashboard-HTML genereres med alle fire seksjoner', () => {
  const output = join(mkdtempSync(join(tmpdir(), 'finnbilglass-c83-')), 'dashboard.html');
  execFileSync('node', ['--import', 'tsx', 'scripts/c83-evidence-dashboard.mjs', '--out', output], { cwd: ROOT });
  const html = readFileSync(output, 'utf8');
  assert.match(html, /Evidence Dashboard/);
  assert.match(html, /Hvilke biler mangler evidens/);
  assert.match(html, /Hvilke features skaper mest spørsmål/);
  assert.match(html, /Hvilke glass har mest usikkerhet/);
  assert.match(html, /Hvilke installasjoner gir mest verdi/);
});
