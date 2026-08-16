// Regresjonstest: vinModelYear — VIN-posisjon 10 → faktisk modellår.
// Rotårsak: SVV gir kun norsk registreringsdato; importbiler registrert senere enn
// modellåret ga feil generasjon. VIN-pos-10 (fabrikkåret) løser det.
// Årskoder: 1980–2000 = A–Y (uten I/O/Q/U/Z), 2001–2009 = 1–9, 2010+ = A–Y igjen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vinModelYear } from '../src/vin-resolver.ts';

// Hjelper: nøyaktig 9 fylltegn + årskoden i posisjon 10 (0-indeksert 9).
const vin = (c) => 'XXXXXXXXX' + c + 'XXXXXXXXXX';

test('VIN-pos-10 «R» med registreringsår 2024 → 2024 (R=1994/2024, hint velger 2024)', () => {
  assert.equal(vinModelYear(vin('R'), 2024), 2024);
});

test('VIN-pos-10 «R» med registreringsår 1995 → 1994 (R=1994/2024, hint velger 1994)', () => {
  assert.equal(vinModelYear(vin('R'), 1995), 1994);
});

test('Importbil: registrert 2024, VIN-pos-10 «K» → 2019 (2019-modell, ikke 2024)', () => {
  assert.equal(vinModelYear(vin('K'), 2024), 2019);
});

test('VIN-pos-10 «5» → 2005 (2001–2009-sifre)', () => {
  assert.equal(vinModelYear(vin('5'), 2006), 2005);
});

test('VIN-pos-10 «N» uten hint → 2022 (2010+-syklus, moderne bilpark)', () => {
  assert.equal(vinModelYear(vin('N'), null), 2022);
});

test('VIN-pos-10 «A» med hint 2023 → 2010 (A=1980/2010 — hint velger 2010)', () => {
  assert.equal(vinModelYear(vin('A'), 2023), 2010);
});

test('Ugyldig VIN (kortere enn 11) → null', () => {
  assert.equal(vinModelYear('SHORT1', 2020), null);
});

test('Tom VIN → null', () => {
  assert.equal(vinModelYear(null, 2020), null);
});

test('VIN-pos-10 «Z» (forbudt tegn) → null', () => {
  assert.equal(vinModelYear(vin('Z'), 2020), null);
});

test('VIN-pos-10 «0» (ugyldig siffer) → null', () => {
  assert.equal(vinModelYear(vin('0'), 2020), null);
});
