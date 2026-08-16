/**
 * Regresjonstester: crosswalk-pipeline (KLA-301, FASE 2).
 * Kjøres: node --test tests/crosswalk-pipeline.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PIPELINE = join(process.cwd(), 'scripts', 'crosswalk-pipeline.mjs');

function kjor(records) {
  const dir = mkdtempSync(join(tmpdir(), 'fbg-xwalk-'));
  const inp = join(dir, 'records.jsonl');
  const out = join(dir, 'out');
  writeFileSync(inp, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const stdout = execFileSync('node', [PIPELINE, '--input', inp, '--out', out, '--fresh'], { encoding: 'utf8' });
  return {
    report: JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')),
    emit: readFileSync(join(out, 'emit.sql'), 'utf8'),
    audit: readFileSync(join(out, 'audit.jsonl'), 'utf8'),
    unresolved: readFileSync(join(out, 'unresolved.jsonl'), 'utf8'),
    stdout,
  };
}

test('Gyldig record → glass_master + identifiers + features + vehicle_links i emit', () => {
  const r = kjor([{
    eurocode: '2525-ACSGY-AVZ1B',
    brand: 'PILKINGTON',
    oem_number: '5G0845011ANVB',
    supplier_number: '8579ACSGYAVZ1B',
    make: 'VW', model: 'T5', year_from: 2003, year_to: 2015,
    rain_sensor: false, camera: true, hud: null,
    category: 'frontrute', lhd_rhd: 'LHD',
  }]);
  assert.equal(r.report.processed, 1);
  assert.equal(r.report.unresolved, 0);
  assert.equal(r.report.uniqueEurocodes, 1);
  assert.equal(r.report.oemMappings, 1);
  assert.ok(r.emit.includes('INSERT OR IGNORE INTO glass_master'));
  assert.ok(r.emit.includes("'2525ACSGYAVZ1B'"), 'eurocode normalisert (separatorer fjernet)');
  assert.ok(r.emit.includes('INSERT OR IGNORE INTO glass_identifiers'));
  assert.ok(r.emit.includes('INSERT OR IGNORE INTO glass_features'));
  assert.ok(r.emit.includes('INSERT OR IGNORE INTO glass_vehicle_links'));
  assert.ok(!/pris|price|tier/i.test(r.emit), 'pipeline setter ALDRI pris — prislisten er eneste priskilde');
  assert.ok(r.audit.includes('"action":"oem_crosswalk"'));
});

test('Ugyldig eurocode → unresolved, aldri gjetting', () => {
  const r = kjor([{ eurocode: '12345', brand: 'X', make: 'VW', model: 'GOLF' }]);
  assert.equal(r.report.processed, 0);
  assert.equal(r.report.unresolved, 1);
  assert.ok(r.unresolved.includes('ugyldig eurocode'));
});

test('Samme eurocode, flere leverandørnumre → én master, flere identifier-rader', () => {
  const r = kjor([
    { eurocode: '2525ACSGYAVZ1B', supplier_number: 'AAAA1111' },
    { eurocode: '2525ACSGYAVZ1B', supplier_number: 'BBBB2222' },
  ]);
  assert.equal(r.report.uniqueEurocodes, 1);
  assert.equal((r.emit.match(/INSERT OR IGNORE INTO glass_identifiers/g) ?? []).length, 4); // 2×EUROCODE + 2×SUPPLIER
  assert.equal((r.emit.match(/INSERT OR IGNORE INTO glass_master/g) ?? []).length, 1);
});

test('Ett OEM-nummer → flere eurokoder dokumenteres i audit (gyldig tilstand)', () => {
  const r = kjor([
    { eurocode: '2525ACSGYAVZ1B', oem_number: '5G0845011ANVB' },
    { eurocode: '2525ACSGYAVZ2B', oem_number: '5G0845011ANVB' },
  ]);
  assert.equal(r.report.oemMappings, 1);
  const crosswalk = JSON.parse(r.audit.trim().split('\n').filter((l) => l.includes('oem_crosswalk'))[0]);
  assert.equal(crosswalk.eurocodes.length, 2);
});

test('Idempotens: state.json resumerer (ingen duplikate master-rader)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fbg-xwalk-resume-'));
  const inp = join(dir, 'records.jsonl');
  const out = join(dir, 'out');
  const recs = [
    { eurocode: '2525ACSGYAVZ1B', brand: 'P' },
    { eurocode: '2525ACSGYAVZ2B', brand: 'P' },
  ];
  writeFileSync(inp, recs.map((x) => JSON.stringify(x)).join('\n') + '\n');
  execFileSync('node', [PIPELINE, '--input', inp, '--out', out, '--fresh'], { encoding: 'utf8' });
  execFileSync('node', [PIPELINE, '--input', inp, '--out', out], { encoding: 'utf8' }); // resume
  const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
  assert.equal(report.processed, 0, 'andre kjøring hopper over alt (checkpoint)');
});
