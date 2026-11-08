import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGlassSelection as parse } from '../src/glass-selection-contract.js';
test('all six glass classes preserve their actual customer fields', () => {
  const cases = [{kind:'windshield'}, {kind:'door',side:'left',door:'sliding'}, {kind:'side',side:'right',section:'rear_quarter',mounting:'door'}, {kind:'rear',layout:'split',splitSide:'left'}, {kind:'ventil',side:'unknown',placement:'rear'}, {kind:'roof',system:'fixed',panel:'front'}];
  for (const value of cases) assert.deepEqual(parse(value),value);
});
test('invalid or incomplete selections are rejected; unknown stays unknown', () => {
  for (const value of [null,[],{kind:'hood'},{kind:'door',side:'else',door:'front'},{kind:'door',side:'left'},{kind:'rear',layout:'single',splitSide:'left'}]) assert.equal(parse(value),null);
  assert.deepEqual(parse({kind:'unknown'}),{kind:'unknown'});
  assert.deepEqual(parse({kind:'rear',layout:'single'}),{kind:'rear',layout:'single'});
});
