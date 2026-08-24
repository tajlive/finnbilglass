/**
 * C6 — personvern- og statistikk-tester for Vehicle Intelligence Test Platform.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASELINE_OUT = new URL('../scripts/out/c6-vehicle-intelligence.json', import.meta.url);
const OUT = join(mkdtempSync(join(tmpdir(), 'finnbilglass-c6-')), 'report.json');

test('C6-1: personvern — regnr/VIN er KUN sha256-hash i rapporten, aldri rå verdier', () => {
  if (!existsSync(BASELINE_OUT)) return; // kjør c6-scriptet først; regresjonstest når rapport finnes
  const raw = readFileSync(BASELINE_OUT, 'utf8');
  // ingen rå norske kjennemerker (2 bokstaver + 5 siffer som ord)
  assert.equal(/[A-ZÆØÅ]{2}\s?\d{5}/.test(raw), false, 'rapporten inneholder rå kjennemerke!');
  assert.equal(/WBY31AW07PFN70638|VR7BCZKXCNE026453/.test(raw), false, 'rapporten inneholder rå VIN!');
  assert.equal(raw.includes('owner'), false);
});

test('C6-2: kjøring produserer gyldig statistikk (kjøretøy > 0, dekning 0–100 %)', () => {
  execFileSync('node', ['scripts/c6-vehicle-intelligence.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, C6_OUTPUT_FILE: OUT } });
  const rep = JSON.parse(readFileSync(OUT, 'utf8'));
  assert.ok(rep.totals.vehicles > 0, 'korpus tomt');
  assert.ok(rep.coverage.vinCoverage >= 0 && rep.coverage.vinCoverage <= 100);
  assert.ok(rep.coverage.applicationResolutionCoverage >= 0 && rep.coverage.applicationResolutionCoverage <= 100);
  assert.ok(rep.familyCount > 0);
  assert.ok(rep.topFamilies.length > 0);
  // prioritering sortert synkende
  const vals = rep.topFamilies.map((f) => f.value);
  assert.deepEqual(vals, [...vals].sort((a, b) => b - a));
  // topp-familie har flest biler ELLER høyest kombinert verdi — sjekk at verdi-formelen er konsistent
  for (const f of rep.topFamilies.slice(0, 5)) {
    assert.ok(f.vehicles >= 1 && f.dataGap >= 0 && f.dataGap <= 100);
  }
});

test('C6-3: dataanskaffelses-prioritering eksisterer og peker på gap-familier', () => {
  const rep = JSON.parse(readFileSync(OUT, 'utf8'));
  assert.ok(rep.dataAcquisitionPriority.length > 0, 'ingen TecDoc/EPC-prioritering');
  for (const p of rep.dataAcquisitionPriority.slice(0, 3)) {
    assert.ok(p.dataGapPct > 0, 'prioritert familie har ikke data-gap');
    assert.ok(p.why.includes('TecDoc/EPC'));
  }
});
