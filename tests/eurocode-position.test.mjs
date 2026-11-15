import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEurocodePosition } from '../src/fitment-v1/normalization/eurocode-position.js';
import { compareEurocodeCandidates } from '../src/fitment-v1/crossref/offline.js';

test('Eurocode parser recognises fronts with 3, 4, or 5 numeric family digits', () => {
  for (const code of ['123AGY', '5689AGNV', '12345AGNV']) {
    const parsed = parseEurocodePosition(code);
    assert.equal(parsed.position, 'WINDSCREEN');
    assert.equal(parsed.normalized, code);
    assert.equal(parsed.familyPrefix.length, code.match(/^\d+/)[0].length);
  }
});

test('Eurocode parser rejects every known OTHER position for frontglass', () => {
  for (const position of ['B', 'F', 'L', 'R', 'S']) {
    const parsed = parseEurocodePosition('5689' + position + 'GN');
    assert.equal(parsed.position, 'OTHER', position);
    assert.equal(parsed.positionCode, position);
  }
});

test('Unknown and incomplete formats are UNKNOWN, not positive proof or other glass', () => {
  for (const code of [null, '', 'AGNGYV', 'BYTTNR', '42C', '7H0877051', '123456AGNV', '5689A', '5689-AGNV']) {
    assert.equal(parseEurocodePosition(code).position, 'UNKNOWN', String(code));
  }
});

test('Normalization keeps original input and full variant suffix', () => {
  const original = ' 5689 aGnV ';
  const parsed = parseEurocodePosition(original);
  assert.equal(parsed.raw, original);
  assert.equal(parsed.normalized, '5689AGNV');
  assert.equal(parsed.variantSuffix, 'GNV');
  assert.ok(parsed.warnings.includes('WHITESPACE_NORMALIZED'));
  assert.equal(parseEurocodePosition('5381AGACMVW1B').variantSuffix, 'GACMVW1B');
  assert.notEqual(parseEurocodePosition('5381AGACMVW1B').normalized, parseEurocodePosition('5381AGACMVW1T').normalized);
});

test('17-character variant code retains full suffix without forced truncation', () => {
  const code = '12345AGNV12345678'; // 17 characters
  assert.equal(code.length, 17);
  const parsed = parseEurocodePosition(code);
  assert.equal(parsed.position, 'WINDSCREEN');
  assert.equal(parsed.normalized, code);
});

test('Crossref compares numeric 5-character family prefix and not first four characters', () => {
  const car={make:'TEST',model:'CAR',year:2020};
  const own=[{id:'local',eurocode:'12345AGNV',make:'TEST',model:'CAR'}];
  const ref=(id,eurocode)=>({id,eurocode,make:'TEST',model:'CAR',sourceId:'research',sourceUrl:'https://example.org/controlled-fixture',observedAt:'2026-11-15',licenseState:'RESEARCH_ONLY'});
  const result=compareEurocodeCandidates(car,own,[ref('different-family','12346AGNV'),ref('same-family','12345AGGY')]);
  assert.deepEqual(result.candidates[0].familyOnlyReferences,['same-family']);
  assert.equal(result.candidates[0].catalogueOverlap,'SAME_FAMILY_ONLY');
  assert.equal(result.autoApproved,false);
});
