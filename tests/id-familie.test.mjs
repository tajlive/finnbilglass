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
import { modellTokensAv, familieTokens, ordTreffKandidat, gtRadMatch, sqlTokensAv, variantKonflikt, modellSynonym, pinpointSperre } from '../src/vin-resolver.ts';

// Faktiske katalograder (brand='VW', frontrute, modell med «ID»).
const KATALOG = [
  'ID.3 5D HBK 2020-',
  'ID.3 5D HBK',
  'ID.4 SUV',
  'ID.7 (EL)',
];

// Speiler L2 (lagPilkington): ord-treff + navnemodell-vakt.
const matcher = (katalogModell, kjoretoyModell) =>
  ordTreffKandidat(katalogModell, modellTokensAv(kjoretoyModell, 'VW'))
  && !variantKonflikt(katalogModell, kjoretoyModell);

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

test('«+» normaliseres til PLUS — Prius+ skal ikke gi falsk variantkonflikt', () => {
  // Katalogen skriver «PRIUS+», SVV skriver «PRIUS PLUS». Målt 2026-11-04:
  // uten denne normaliseringen mistet Prius+ alle kandidater.
  assert.equal(matcher('PRIUS+', 'PRIUS PLUS'), true);
  assert.equal(matcher('PRIUS PLUS', 'PRIUS+'), true);
  // Ekte navnemodell-konflikt består.
  assert.equal(matcher('GOLF', 'GOLF SPORTSVAN'), false);
});

test('drivlinjevariant arver ikke en annen modells rad (ensidig vakt)', () => {
  // SVV skriver «V60 PLUG IN HYBRID» og «RAV4 PHV». PR #26s kontrakt er at en
  // variant ikke skal arve grunnmodellens glass før fitment er dokumentert.
  // Vakten er ensidig: den ser bare på ord kjøretøyet oppgir og raden mangler.
  assert.equal(gtRadMatch('V60', 'VOLVO', 'V60 PLUG IN HYBRID', [2013]), false);
  assert.equal(gtRadMatch('RAV-4', 'TOYOTA', 'RAV4 PHV', [2024]), false);
  // Raden kan beskrive drivlinjen uten at det blokkerer en ren modell.
  assert.equal(gtRadMatch('NIRO (HYBRID) 2016-2022', 'KIA', 'Niro', [2022]), true);
});

test('PRIUS PLUS = GRAND PRIUS (butikkatalog vs leverandørkatalog)', () => {
  // Butikken fører «TOYOTA PRIUS PLUS 7 + 5D CC 12- FR…», Pilkington-katalogen
  // kaller samme bil «GRAND PRIUS LHD 04/2012 · 2012-2022» (målt 2026-11-04).
  assert.equal(modellSynonym('PRIUS PLUS'), 'GRAND PRIUS');
  assert.equal(modellSynonym('PRIUS+'), 'GRAND PRIUS');
  assert.equal(modellSynonym('PRIUS+SEVEN'), 'GRAND PRIUS');
  assert.equal(modellSynonym('PRIUS 5D CC'), 'PRIUS 5D CC', 'vanlig Prius skal ikke omdøpes');

  assert.equal(gtRadMatch('GRAND PRIUS LHD 04/', 'TOYOTA', 'PRIUS PLUS', [2013]), true);
  assert.equal(gtRadMatch('GRAND PRIUS LHD 04/', 'TOYOTA', 'PRIUS 5D CC', [2013]), false,
    'vanlig Prius skal ikke få Grand Prius-raden');
  assert.equal(gtRadMatch('PRIUS 5D HBK LHD', 'TOYOTA', 'PRIUS PLUS', [2013]), false,
    'Prius+ skal ikke få vanlig Prius-rute');
});

test('PINPOINT-sperre: RAV4 2022-2025 på 8432AGAC gir VERIFY, ikke PINPOINT', () => {
  // Butikken fører «TOYOTA RAV 4 19-21 FR…» atskilt fra «TOYOTA RAV 4 2019- FR…»,
  // mens GT mapper 2022-2025 til 8432AGAC. GT-årene endres ikke — PINPOINT sperres.
  for (const aar of [2022, 2023, 2024, 2025]) {
    assert.ok(pinpointSperre('TOYOTA', 'RAV4', aar, '8432AGACHM'), `RAV4 ${aar} skal være sperret`);
    assert.ok(pinpointSperre('TOYOTA', 'RAV 4', aar, '8432AGAC'), `«RAV 4» ${aar} skal være sperret`);
  }
  // SVV kan sende merkenavnet inni modellstrengen («TOYOTA RAV4»).
  assert.ok(pinpointSperre('TOYOTA', 'TOYOTA RAV4', 2024, '8432AGACHM'), '«TOYOTA RAV4» skal også sperres');
  // Utenfor sperren: eldre år, andre koder, andre modeller.
  assert.equal(pinpointSperre('TOYOTA', 'RAV4', 2021, '8432AGACHM'), null);
  assert.equal(pinpointSperre('TOYOTA', 'RAV4', 2026, '8465AGAC'), null);
  assert.equal(pinpointSperre('TOYOTA', 'RAV4', 2024, '8410AGAHMW'), null, 'RAV-4 13-serien er ikke sperret');
  assert.equal(pinpointSperre('TOYOTA', 'COROLLA', 2024, '8432AGACHM'), null);
  assert.equal(pinpointSperre('VOLVO', 'V60', 2024, '8432AGACHM'), null);
  assert.equal(pinpointSperre('TOYOTA', 'RAV4', null, '8432AGACHM'), null, 'uten år ingen sperre');
});
