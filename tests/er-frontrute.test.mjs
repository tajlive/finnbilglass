// Regresjonstest: erFrontrute må avvise SIDE-/BAK-glass — også med 3-sifret eurokode-prefiks.
// Rotårsak 2026-08-16: regex krevde 4–5 sifre («^(\d{4,5})([A-Z])»), så «538LRG…» (CLA-siderute)
// og «671R…» (911-siderute) slapp gjennom som frontrute → 31 feilaktige GT-rader i prod.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { erFrontrute } from '../scripts/gt-generator.mjs';

test('sideglass 3-sifret prefiks + L → ikke frontrute (CLA 30199GN)', () => {
  assert.equal(erFrontrute('MERCEDES CLA 13-19', '30199GN', '538LRGSC4RVWZ1M'), false);
});

test('sideglass 3-sifret prefiks + R → ikke frontrute (911 21438GN)', () => {
  assert.equal(erFrontrute('PORSCHE 911 98-', '21438GN', '671RGNC2FV'), false);
});

test('bakrute 4-sifret prefiks + B → ikke frontrute (SIGMA 1747BZB)', () => {
  assert.equal(erFrontrute('MITSUBISHI SIGMA 77-', '1747BZB', '5636BZBL'), false);
});

test('sideglass 5-sifret prefiks + L → ikke frontrute (SPACE RUNNER 1766BY)', () => {
  assert.equal(erFrontrute('MITSUBISHI SPACE RUNNER', '1766BY', '26270LFWX-BYN'), false);
});

test('frontrute A-posisjon → frontrute (8579AGSGYAVZ1B)', () => {
  assert.equal(erFrontrute('VW TRANSPORTER T5 03-15', '8579AGSGYAVZ1B', '8579AGSGYAVZ1B'), true);
});

test('frontrute 3-sifret prefiks + A → frontrute (CLA 3172-serien)', () => {
  assert.equal(erFrontrute('MERCEDES CLA 13-19', '5381AGAACMVW1B', '5381AGAACMVW1B'), true);
});

test('veteran 2-sifret kode faller gjennom → frontrute-kandidat («42C»)', () => {
  assert.equal(erFrontrute('GAMMEL BIL 1960', '42C', '42C'), true);
});

test('SOLTAK-keyword → ikke frontrute (AUDI A2 soltak)', () => {
  assert.equal(erFrontrute('AUDI A2 00-05 SOLTAK', '8562GBZH5', '8Z0877055'), false);
});

test('PAKNING-keyword → ikke frontrute (AUDI A6 pakning)', () => {
  assert.equal(erFrontrute('AUDI A6 4B 97-04 PAKNING SOLTAK', '8589GZPE5', '8K9877071'), false);
});

test('SIDORUTA (svensk) → ikke frontrute (SUZUKI SJ410)', () => {
  assert.equal(erFrontrute('SUZUKI SJ410 85- SIDORUTA CL VS+HS', '10054CL', '8005FCLR3RQ'), false);
});

test('F-posisjon (ventilrute) → ikke frontrute', () => {
  assert.equal(erFrontrute('SUZUKI SJ410 85-', '10054CL', '8005FCLR3RQ'), false);
});

test('S-posisjon (siderute) → ikke frontrute', () => {
  assert.equal(erFrontrute('VOLVO S60 01-', '1234SGN', '5321SGNC1'), false);
});

test('«BYTTNR»-plassholder (ikke eurokode) faller gjennom → frontrute-kandidat', () => {
  assert.equal(erFrontrute('FORD TRANSIT 86-99 FRONTRUTE EL.', '1456GYEL', 'BYTTNR'), true);
});

test('«VENT» må IKKE treffe «VENTURE» (modellnavn) → frontrute-kandidat', () => {
  assert.equal(erFrontrute('CHEVROLET VENTURE 97-', 'W1454GB', '6281AGNBLVZ'), true);
});

test('«VENT» alene (ventilrute) → ikke frontrute — posisjon A isolerer keywordet', () => {
  assert.equal(erFrontrute('FORD ESCORT VENT 80-', '1310CL', '5453ACL'), false);
});

test('«HATCH» må IKKE treffe «HATCHBACK» → frontrute-kandidat', () => {
  assert.equal(erFrontrute('FORD FIESTA HATCHBACK 89-', '1440GN', '5137AGN'), true);
});

test('«ALLE MOD» er fjernet — MAZDA 323 ALLE MOD med posisjon A → frontrute-kandidat', () => {
  assert.equal(erFrontrute('MAZDA 323 ALLE MOD 86-89', '1413BL', '5125ABL'), true);
});

test('«ALLE MOD» er fjernet, men DØRRUTE fanger fortsatt (MAZDA 6 DØRRUTE)', () => {
  assert.equal(erFrontrute('MAZDA 6 ALLE MOD 13- DØRRUTE', '29969GN', '5180LGSS4FDW'), false);
});
