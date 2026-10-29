import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGlassRequest, parseGlassSelection, normalizeGlassRequest, glassSelectionLabel } from '../src/glass-selection.ts';

const valid = (selection) => ({ schemaVersion: 1, selection, answers: {} });

test('accepts all glass kinds without inventing side or panel defaults', () => {
  const selections = [
    { kind: 'windshield' }, { kind: 'door', side: 'unknown', door: 'unknown' },
    { kind: 'side', side: 'right', section: 'rear_quarter', mounting: 'body' },
    { kind: 'rear', layout: 'split', splitSide: 'left' },
    { kind: 'roof', system: 'unknown', panel: 'unknown' }, { kind: 'unknown' },
  ];
  for (const selection of selections) assert.deepEqual(parseGlassRequest(valid(selection))?.selection, selection);
  assert.match(glassSelectionLabel(selections[1]), /Ukjent side/);
});

test('rejects malformed requests and impossible or extra fields', () => {
  for (const input of [null, [], {}, { ...valid({ kind: 'roof', system: 'fixed', panel: 'whole' }), extra: 1 },
    { ...valid({ kind: 'door', side: 'driver', door: 'front' }) },
    { ...valid({ kind: 'rear', layout: 'single', splitSide: 'left' }) },
    { ...valid({ kind: 'roof', system: 'fixed', panel: 'whole', side: 'left' }) },
    { ...valid({ kind: 'windshield' }), schemaVersion: 2 },
    { ...valid({ kind: 'windshield' }), answers: { fake: true } },
    { ...valid({ kind: 'windshield' }), answers: { construction: 'plastic' } }]) assert.equal(parseGlassRequest(input), null);
  assert.equal(parseGlassSelection(null), null);
});

test('canonical request ignores object key order and search id', () => {
  const a = parseGlassRequest({ schemaVersion: 1, selection: { kind: 'door', side: 'left', door: 'rear' }, answers: { heating: true, construction: 'tempered' }, searchId: 'abcdefghijklmnopqrst' });
  const b = parseGlassRequest({ schemaVersion: 1, selection: { kind: 'door', side: 'left', door: 'rear' }, answers: { construction: 'tempered', heating: true } });
  assert.equal(normalizeGlassRequest(a), normalizeGlassRequest(b));
});
