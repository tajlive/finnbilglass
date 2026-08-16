/* Regresjonstester: skillendeSporsmaal (vin-resolver).
   Doktrine: ALDRI spør kunden om funksjoner som ikke skiller kandidatene.
   Et felt skiller KUN når minst én kandidat har true OG minst én har false;
   ukjente (null) og identiske verdier gir aldri spørsmål. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skillendeSporsmaal } from '../src/vin-resolver.ts';

function k(varenr, attributter) {
  return { varenr, varenavn: null, pris: null, listepris: null, eurokode: null, attributter };
}

test('skillendeSporsmaal: kun felt som faktisk skiller returneres', () => {
  const res = skillendeSporsmaal([
    k('A', { sensor: true, antenne: false, hud: null, kamera: null, adas: null }),
    k('B', { sensor: false, antenne: false, hud: null, kamera: null, adas: null }),
  ]);
  assert.deepEqual([...res].sort(), ['sensor']); // antenne er lik, resten ukjent → aldri spurt
});

test('skillendeSporsmaal: alle null → ingen spørsmål', () => {
  const res = skillendeSporsmaal([
    k('A', { sensor: null, antenne: null, hud: null, kamera: null, adas: null }),
    k('B', { sensor: null, antenne: null, hud: null, kamera: null, adas: null }),
  ]);
  assert.deepEqual(res, []);
});

test('skillendeSporsmaal: identiske verdier → ingen spørsmål', () => {
  const res = skillendeSporsmaal([
    k('A', { sensor: true, antenne: true, hud: false, kamera: false, adas: null }),
    k('B', { sensor: true, antenne: true, hud: false, kamera: false, adas: null }),
  ]);
  assert.deepEqual(res, []);
});

test('skillendeSporsmaal: flere skillende felt (sens + kamera), ukjente ignoreres', () => {
  const res = skillendeSporsmaal([
    k('A', { sensor: true, antenne: null, hud: null, kamera: true, adas: false }),
    k('B', { sensor: false, antenne: null, hud: null, kamera: false, adas: false }),
    k('C', { sensor: true, antenne: null, hud: null, kamera: false, adas: false }),
  ]);
  assert.deepEqual([...res].sort(), ['kamera', 'sensor']);
});
