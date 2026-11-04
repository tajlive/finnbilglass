// ID-familien og modellfamilie-tokens.
//
// Bakgrunn (målt 2026-11-04): `modellTokensAv('ID.4','VW')` ga `['ID']` fordi
// enkelttegnet «4» ble forkastet (regelen er «tokens ≥ 2 tegn»). `ordTreff`
// godtar ETT treffende token, så «ID» matchet ID.3, ID.4, ID.5 og ID.7 — og en
// ID.3-frontrute (8652AGAC / 8652AGACMUVZ) ble tilbudt som kandidat for ID.4 og
// ID.5 (testbilene FBG-T-0091, -0093, -0096, -0097).
//
// Testene låser at modellfamilier med skilletegn + siffer bevares (ID4, MODEL3,
// RAV4), og at et generisk treff («ID», «MODEL») aldri alene gir kandidatstøtte.
//
// Katalogstrengene under er kopiert fra staging `glass_catalog` (målt 2026-11-04),
// ikke oppdiktet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modellTokensAv, familieTokens, ordTreffKandidat, gtRadMatch, sqlTokensAv } from '../src/vin-resolver.ts';

// Faktiske katalograder (brand='VW', frontrute, modell med «ID»).
const KATALOG = [
  'ID.3 5D HBK 2020-',
  'ID.3 5D HBK',
  'ID.4 SUV',
  'ID.7 (EL)',
];

const matcher = (katalogModell, kjoretoyModell) =>
  ordTreffKandidat(katalogModell, modellTokensAv(kjoretoyModell, 'VW'));

test('familieTokens bevarer sifferet i modellfamilier', () => {
  assert.deepEqual(familieTokens('ID.4'), ['ID4']);
  assert.deepEqual(familieTokens('ID.4 GTX'), ['ID4']);
  assert.deepEqual(familieTokens('MODEL 3'), ['MODEL3']);
  assert.deepEqual(familieTokens('RAV-4'), ['RAV4']);
  assert.deepEqual(familieTokens('RAV 4'), ['RAV4']);
  // Motorkode er ikke modellfamilie: «TRANSIT 2.0» skal ikke gi TRANSIT2.
  assert.deepEqual(familieTokens('TRANSIT 2.0'), []);
  // Modeller uten skilletegn + siffer er uendret.
  assert.deepEqual(familieTokens('GOLF'), []);
});

test('modellTokensAv: ID.4 gir familie-token og ikke det generiske «ID»', () => {
  const t = modellTokensAv('ID.4', 'VW');
  assert.ok(t.includes('ID4'), `forventet ID4 i ${JSON.stringify(t)}`);
  assert.ok(!t.includes('ID'), `generisk ID skal være fjernet, fikk ${JSON.stringify(t)}`);
});

test('SQL-forfiltreringen bruker rå ord, ikke familie-tokenet', () => {
  // LIKE '%ID4%' matcher ikke katalograder som skriver «ID.4 SUV» — målt
  // 2026-11-04: hele ID.4/ID.5-familien falt til FALLBACK av nettopp dette.
  assert.deepEqual(sqlTokensAv('ID.4', 'VW'), ['ID']);
  assert.deepEqual(sqlTokensAv('MODEL Y', 'TESLA'), ['MODEL']);
  assert.ok(!sqlTokensAv('ID.4', 'VW').includes('ID4'));
});

test('ID.4 matcher ikke ID.3, ID.5 eller ID.7 på grunnlag av «ID» alene', () => {
  assert.equal(matcher('ID.3 5D HBK 2020-', 'ID.4'), false, 'ID.3-rad skal ikke være kandidat for ID.4');
  assert.equal(matcher('ID.7 (EL)', 'ID.4'), false, 'ID.7-rad skal ikke være kandidat for ID.4');
  assert.equal(matcher('ID.4 SUV', 'ID.4'), true, 'ID.4-rad skal fortsatt være kandidat for ID.4');
});

test('ID.5 får aldri ID.3- eller ID.4-glass når katalogen mangler ID.5', () => {
  for (const rad of KATALOG) {
    assert.equal(matcher(rad, 'ID.5'), false, `«${rad}» skal ikke være kandidat for ID.5`);
  }
  assert.ok(!modellTokensAv('ID.5', 'VW').includes('ID'), 'ID.5 skal ikke falle tilbake til generisk ID');
});

test('ID.4 GTX får ID.4-variantene (VERIFY), aldri ID.3', () => {
  assert.equal(matcher('ID.4 SUV', 'ID.4 GTX'), true, 'ID.4 GTX skal se ID.4-variantene');
  assert.equal(matcher('ID.3 5D HBK 2020-', 'ID.4 GTX'), false, 'ID.4 GTX skal aldri se ID.3');
});

test('generisk token alene gir aldri kandidatstøtte', () => {
  assert.equal(ordTreffKandidat('ID.4 SUV', ['ID']), false);
  assert.equal(ordTreffKandidat('MODEL 3', ['MODEL']), false);
  assert.equal(ordTreffKandidat('ID.4 SUV', ['ID4']), true);
});

test('Tesla Model 3 og Model Y holdes fortsatt adskilt', () => {
  // Katalogsiden
  assert.equal(matcher('MODEL 3', 'Model 3'), true);
  assert.equal(matcher('MODEL Y', 'Model 3'), false);
  assert.equal(matcher('MODEL Y', 'Model Y'), true);
  assert.equal(matcher('MODEL 3', 'Model Y'), false);
  // GT-siden (samme vakt som PR #26 innførte)
  assert.equal(gtRadMatch('MODEL 3', 'TESLA', 'Model 3', [2023]), true);
  assert.equal(gtRadMatch('MODEL Y', 'TESLA', 'Model 3', [2023]), false);
});

test('RAV4-familien er uendret av familie-tokenet', () => {
  assert.equal(gtRadMatch('RAV-4', 'TOYOTA', 'RAV4', [2018]), true);
  assert.equal(gtRadMatch('RAV-4', 'TOYOTA', 'RAV 4', [2018]), true);
  assert.equal(matcher('RAV-4', 'RAV 4'), true);
});

test('RAV4 Plug-in Hybrid får ikke en ren RAV 4-rad (variant skal ikke gjettes)', () => {
  // Familie-tokenet (RAV4) gjør at varianten ellers treffer «RAV 4» på ett token.
  assert.equal(gtRadMatch('RAV 4', 'TOYOTA', 'RAV4 Plug-in Hybrid', [2024]), false);
  assert.equal(gtRadMatch('RAV-4', 'TOYOTA', 'RAV4 Plug-in Hybrid', [2024]), false);
  // Ren RAV4 skal fortsatt matche begge stavemåter.
  assert.equal(gtRadMatch('RAV-4', 'TOYOTA', 'RAV4', [2024]), true);
});
