import assert from 'node:assert/strict';
import test from 'node:test';
import { searchGlass } from '../src/glass-search.ts';
import { parseGlassRequest } from '../src/glass-selection.ts';

const door = parseGlassRequest({ schemaVersion: 1, selection: { kind: 'door', side: 'left', door: 'rear' }, answers: {} });
const rows = [
  { item_id: 'right', part_number: 'RIGHT', manufacturer: null, position_json: '{"kind":"door","side":"right","door":"rear"}', attributes_json: '{}', source_version: 'v1', body_variant: null },
  { item_id: 'left', part_number: 'LEFT', manufacturer: 'Supplier', position_json: '{"door":"rear","side":"left","kind":"door"}', attributes_json: '{}', source_version: 'v1', body_variant: null },
];
function dbWith(resultRows = rows) {
  return { prepare() { return { bind(...args) { this.args = args; return this; }, async all() { return { results: resultRows }; } }; } };
}
const vehicle = { merke: 'VW', modell: 'Golf', vin: 'WVWZZZ1JZXW000001', aar: 1999, generation: 'G1', bodyVariant: '5D' };

test('unknown placement and unknown vehicle fail closed before catalogue access', async () => {
  const unknown = parseGlassRequest({ schemaVersion: 1, selection: { kind: 'door', side: 'unknown', door: 'rear' }, answers: {} });
  const queryThatMustNotRun = { prepare() { throw new Error('unexpected catalogue query'); } };
  assert.equal((await searchGlass(queryThatMustNotRun, vehicle, unknown)).status, 'NEEDS_DETAILS');
  assert.equal((await searchGlass(queryThatMustNotRun, null, door)).status, 'MANUAL_REVIEW');
  assert.equal((await searchGlass(queryThatMustNotRun, { merke: 'VW', modell: 'Golf', vin: vehicle.vin, aar: 1999 }, door)).status, 'MANUAL_REVIEW');
});

test('matches exact position independent of JSON key order and excludes wrong side', async () => {
  let bound;
  const trackedDb = { prepare(sql) { assert.match(sql, /a\.generation_key = \?/); assert.match(sql, /a\.body_variant = \?/); return { bind(...args) { bound = args; return this; }, async all() { return { results: rows }; } }; } };
  const result = await searchGlass(trackedDb, vehicle, door);
  assert.equal(result.status, 'CANDIDATES');
  assert.deepEqual(result.candidates.map(c => c.candidateId), ['left']);
  assert.deepEqual(bound.slice(-4), ['G1', 1999, 1999, '5D']);
});

test('no documented rows returns manual review and never falls back to windshield', async () => {
  const result = await searchGlass(dbWith([]), vehicle, door);
  assert.equal(result.status, 'MANUAL_REVIEW');
  assert.deepEqual(result.candidates, []);
});

test('manglende søkeår gir manuell kontroll', async () => {
  const result = await searchGlass(dbWith(), { ...vehicle, aar: null }, door);
  assert.equal(result.status, 'MANUAL_REVIEW');
});

test('SVV-år brukes selv når VIN-posisjon 10 ikke er årskode', async () => {
  let bound;
  const db = { prepare() { return { bind(...args) { bound = args; return this; }, async all() { return { results: rows }; } }; } };
  const result = await searchGlass(db, { ...vehicle, vin: 'WDF44760313091199', aar: 2015 }, door);
  assert.equal(result.status, 'CANDIDATES');
  assert.deepEqual(bound.slice(-4), ['G1', 2015, 2015, '5D']);
});

test('ukjent leverandøregenskap fjerner ikke et mulig glass', async () => {
  const selected = parseGlassRequest({ schemaVersion: 1, selection: { kind: 'door', side: 'left', door: 'rear' }, answers: { heating: true } });
  const options = [
    { ...rows[1], item_id: 'unknown', attributes_json: '{}' },
    { ...rows[1], item_id: 'yes', attributes_json: '{"heating":true}' },
    { ...rows[1], item_id: 'no', attributes_json: '{"heating":false}' },
  ];
  const result = await searchGlass(dbWith(options), vehicle, selected);
  assert.deepEqual(result.candidates.map(c => c.candidateId), ['unknown', 'yes']);
});
