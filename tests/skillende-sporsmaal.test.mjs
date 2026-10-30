// P0-regresjonstester: aldri generiske utstyrsspørsmål (Tom-doktrine).
// skillendeSporsmaal() skal kun gi spørsmål når en egenskap finnes som
// kandidatvariant (både true OG false blant kandidatene) og dermed kan skille.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { skillendeSporsmaal } from '../src/vin-resolver.ts';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function k(sensor = null, antenne = null, hud = null, kamera = null, adas = null, coated = null) {
  return {
    varenr: 'TEST-' + Math.random().toString(36).slice(2, 6),
    varenavn: null,
    pris: null,
    listepris: null,
    eurokode: null,
    attributter: { sensor, antenne, hud, kamera, adas, coated },
  };
}

test('1 kandidat → 0 spørsmål (kan ikke skille med én)', () => {
  assert.deepEqual(skillendeSporsmaal([k(true, true, true, true, true, true)]), []);
});

test('flere kandidater, ingen utstyrsvariasjon → 0 spørsmål', () => {
  // alle har sensor=true, resten null → ingen variasjon å skille på
  assert.deepEqual(skillendeSporsmaal([k(true), k(true), k(true)]), []);
});

test('flere kandidater, kun sensor skiller (true/false) → bare sensor', () => {
  assert.deepEqual(skillendeSporsmaal([k(true, null, null, null, null, null), k(false, null, null, null, null, null)]), ['sensor']);
});

test('ingen antennekandidat (alle null) → aldri antennespørsmål', () => {
  // antenne er null (ukjent) for begge → kan ikke skille på antenne
  const r = skillendeSporsmaal([k(null, null), k(null, null)]);
  assert.equal(r.includes('antenne'), false);
});

test('kun true + null (ikke false) → 0 spørsmål (svaret kan ikke skille)', () => {
  // A har sensor=true, B har sensor=null (ukjent) → kan IKKE skille sikkert
  assert.deepEqual(skillendeSporsmaal([k(true), k(null)]), []);
});

test('app.js fallback: aldri generisk sensor/antenne/coated-liste', () => {
  const app = readFileSync(join(ROOT, 'public', 'app.js'), 'utf8');
  // Den gamle fallback-linjen (settSpm med : ['sensor','antenne','coated']) skal være borte.
  // (Den legitime bruken i filtrerResolverKandidater er kundesvar-filtrering, ikke fallback.)
  assert.equal(app.includes("resolver.sporsmaal : ['sensor', 'antenne', 'coated']"), false, 'app.js har fortsatt generisk fallback');
  // Den nye safe default-en skal være til stede.
  assert.match(app, /resolver\s*&&\s*Array\.isArray\(resolver\.sporsmaal\)\s*\?\s*resolver\.sporsmaal\s*:\s*\[\]/);
});

test('skillendeSporsmaal dekker feltlisten (sensor/antenne/hud/kamera/adas/coated)', () => {
  // to kandidater som skiller på ALLE felter → alle felter spørres
  const a = k(true, true, true, true, true, true);
  const b = k(false, false, false, false, false, false);
  assert.deepEqual(skillendeSporsmaal([a, b]), ['sensor', 'antenne', 'hud', 'kamera', 'adas', 'coated']);
});
