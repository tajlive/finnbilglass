import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const IMPORTER = join(process.cwd(), 'scripts', 'import-tecdoc-snapshot.mjs');

function snapshot(manifest, vehicles = [], parts = []) {
  const dir = mkdtempSync(join(tmpdir(), 'fbg-tecdoc-'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(dir, 'vehicles.jsonl'), vehicles.map((v) => JSON.stringify(v)).join('\n') + '\n');
  if (parts.length) writeFileSync(join(dir, 'parts.jsonl'), parts.map((p) => JSON.stringify(p)).join('\n') + '\n');
  return dir;
}
function run(dir) {
  try { return { out: execFileSync('node', [IMPORTER, '--snapshot', dir], { encoding: 'utf8' }), code: 0 }; }
  catch (error) { return { out: `${error.stdout ?? ''}${error.stderr ?? ''}`, code: error.status }; }
}
const manifest = {
  schema: 'finnbilglass-tecdoc-snapshot/v1',
  license_ref: 'tecdoc-contract-2026-01',
  redistribution_permitted: true,
  source_version: '2026-W33',
};

test('avviser snapshot uten eksplisitt lokal lagringsrett', () => {
  const dir = snapshot({ ...manifest, redistribution_permitted: false });
  const r = run(dir);
  assert.equal(r.code, 2);
  assert.match(r.out, /lokal lagring/);
});

test('dry-run normaliserer en lisensiert OE→eurocode-kobling uten å sette pris', () => {
  const dir = snapshot(manifest, [], [{
    eurocode: '8618-AGAMVZ1B',
    oem_number: '5G0845011A',
    make: 'VW', model: 'GOLF VII', year_from: 2012, year_to: 2020,
  }]);
  const r = run(dir);
  assert.equal(r.code, 0);
  const emit = readFileSync(join(dir, '.finnbilglass-import', 'crosswalk', 'emit.sql'), 'utf8');
  assert.match(emit, /8618AGAMVZ1B/);
  assert.match(emit, /5G0845011A/);
  assert.doesNotMatch(emit, /price|pris/i);
});

test('dry-run slipper bare VIN-kType med confidence >= 0.90', () => {
  const dir = snapshot(manifest, [
    { vin: 'WVWZZZ1KZ6W000001', ktype: 12345, confidence: 0.95, make: 'VW', model: 'GOLF', year: 2018 },
    { vin: 'WVWZZZ1KZ6W000002', ktype: 12346, confidence: 0.75, make: 'VW', model: 'GOLF', year: 2018 },
  ]);
  const r = run(dir);
  assert.equal(r.code, 0);
  const report = JSON.parse(readFileSync(join(dir, '.finnbilglass-import', 'report.json'), 'utf8'));
  assert.equal(report.vehiclesAccepted, 1);
  assert.equal(report.vehiclesRejected, 1);
  const sql = readFileSync(join(dir, '.finnbilglass-import', '02_vehicles.sql'), 'utf8');
  assert.match(sql, /WVWZZZ1KZ6W000001/);
  assert.doesNotMatch(sql, /WVWZZZ1KZ6W000002/);
});
