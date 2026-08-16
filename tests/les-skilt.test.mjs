import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliserSkilt } from '../src/les-skilt.ts';

test('normaliserSkilt: standard norsk skilt AB12345', () => {
  const r = normaliserSkilt('SU18018');
  assert.equal(r?.regnr, 'SU18018');
  assert.ok((r?.confidence ?? 0) > 0.8);
});

test('normaliserSkilt: tåler mellomrom og bindestrek', () => {
  assert.equal(normaliserSkilt('SU 18018')?.regnr, 'SU18018');
  assert.equal(normaliserSkilt('su-18018')?.regnr, 'SU18018');
  assert.equal(normaliserSkilt('SU – 18018')?.regnr, 'SU18018');
});

test('normaliserSkilt: hentes fra AI-tekstsvar', () => {
  assert.equal(normaliserSkilt('The plate is SU18018.')?.regnr, 'SU18018');
  assert.equal(normaliserSkilt('Plate: AB12345\nThanks')?.regnr, 'AB12345');
});

test('normaliserSkilt: null ved ugyldig format', () => {
  assert.equal(normaliserSkilt('NONE'), null);
  assert.equal(normaliserSkilt(''), null);
  assert.equal(normaliserSkilt('12345'), null);
  assert.equal(normaliserSkilt('ABCD123'), null); // 4 bokstaver
  assert.equal(normaliserSkilt('A12345'), null);  // 1 bokstav (eldre format, ikke aktivt)
});
