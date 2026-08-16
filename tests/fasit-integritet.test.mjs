// Fasit-integritetstest — vakten mot feilklassen fra 2026-08-16 (SU18018 fikk feil glass i prod i 3 døgn).
//
// DOKTRINE: data/fasit-glass.json er ENESTE sannhetskilde for Tom-verifiserte fasiter.
// Denne testen feiler bygget hvis:
//   1. En VIN-override i seed-SQL peker på en annen eurokode enn fasit-filen.
//   2. En hard regresjonstest (test-fasit.mjs) sjekker mot en annen eurokode enn fasit-filen.
//   3. En fasit-oppføring mangler sporbar kilde ("kilde" med dato).
//
// Endring av fasit = oppdater data/fasit-glass.json med Tom-sitat + dato. Aldri bare i SQL/tester.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fasit = JSON.parse(readFileSync(join(rot, 'data/fasit-glass.json'), 'utf8'));
const seedSql = readFileSync(join(rot, 'data/vin-glass-overrides.sql'), 'utf8');
const testFasitSrc = readFileSync(join(rot, 'scripts/test-fasit.mjs'), 'utf8');

test('alle fasiter har sporbar kilde med dato', () => {
  for (const f of fasit.fasiter) {
    assert.ok(f.kilde && /20\d\d-\d\d-\d\d/.test(f.kilde), `${f.regnr}: mangler kilde med dato`);
    assert.ok(f.verifisert, `${f.regnr}: mangler verifisert-dato`);
  }
});

test('seed-SQL vin_glass_overrides matcher fasit-filen', () => {
  for (const f of fasit.fasiter) {
    if (!f.vin || !f.eurocode) continue;
    // Finn raden for denne VIN-en i seed-SQL
    const vinIdx = seedSql.indexOf(f.vin);
    assert.ok(vinIdx >= 0, `${f.regnr}: VIN ${f.vin} finnes ikke i seed-SQL`);
    const rad = seedSql.slice(vinIdx, seedSql.indexOf('\n', vinIdx));
    assert.ok(
      rad.includes(f.eurocode),
      `${f.regnr}: seed-SQL har annen eurokode enn fasit (forventet ${f.eurocode}). Rad: ${rad.slice(0, 120)}`
    );
    // Sjekk at ingen ANNEN eurokode-lignende streng står i raden for samme VIN
    const koder = rad.match(/'\d{4}[A-Z]{1,10}\d?[A-Z]?'/g) ?? [];
    for (const k of koder) {
      const ren = k.replaceAll("'", '');
      if (/^\d{4}[A-Z]/.test(ren) && ren.length >= 8) {
        assert.equal(ren, f.eurocode, `${f.regnr}: seed-SQL inneholder avvikende kode ${ren}`);
      }
    }
  }
});

test('harde regresjonstester (test-fasit.mjs) matcher fasit-filen', () => {
  for (const f of fasit.fasiter) {
    if (!f.eurocode) continue;
    assert.ok(
      testFasitSrc.includes(f.eurocode),
      `${f.regnr}: test-fasit.mjs sjekker ikke mot fasit-eurokoden ${f.eurocode}`
    );
  }
  // Kjente FEIL-koder skal ALDRI være krav i regresjonstester
  const kravLinjer = testFasitSrc.split('\n').filter((l) => l.includes('krav:'));
  for (const linje of kravLinjer) {
    assert.ok(
      !linje.includes('8579ACSGYAVZ1B'),
      'test-fasit.mjs krever den kjente FEIL-koden 8579ACSGYAVZ1B (coated) — se data/fasit-glass.json'
    );
  }
});

test('fasit-eurokoder er innbyrdes konsistente med varenr-notat', () => {
  const su = fasit.fasiter.find((f) => f.regnr === 'SU18018');
  assert.ok(su, 'SU18018 mangler i fasit-filen');
  assert.equal(su.varenr, '2525GYA');
  assert.equal(su.eurocode, '8579AGSGYAVZ1B');
  assert.ok(!su.eurocode.includes('ACS'), 'SU18018 skal IKKE være coated-varianten');
});
