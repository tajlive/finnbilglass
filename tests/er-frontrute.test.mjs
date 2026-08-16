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
