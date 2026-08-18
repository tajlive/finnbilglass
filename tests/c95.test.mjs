/**
 * C9.5 Phase 1 — Finn Vehicle Intelligence-tester.
 * Finn = markedssensor (aldri sannhet). Kandidatunion gt + Glavista (klassifisert CLASS_D, aldri EXACT).
 * Topp 3: BMW 3-SERIE, NISSAN LEAF, TESLA MODEL-Y.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildClassDCandidates, matchClassDCandidates } from '../src/fitment-v1/catalogue-candidates.js';

const ROOT = new URL('..', import.meta.url).pathname;

test('C9.5-1: slice(3)-fix — år-spesifikke biler uten generasjons-hint får gt-kandidater (LEAF/Model Y/RAV4)', () => {
  const gt = JSON.parse(readFileSync(fileURLToPath(new URL('../data/gt-ekspansjon/prisliste-alle-glass.json', import.meta.url)), 'utf8'));
  const classD = buildClassDCandidates(gt[0].results);
  for (const [make, model, year] of [['NISSAN', 'LEAF', 2019], ['TESLA', 'MODEL Y', 2023], ['TOYOTA', 'RAV4', 2018], ['VW', 'PASSAT', 2016]]) {
    const c = matchClassDCandidates(classD, make, model, year);
    assert.ok(c.length >= 1, `${make} ${model} ${year} må ha ≥1 kandidat (var 0 før fixen)`);
  }
});

test('C9.5-2: script-integritet — topp 3 med Glavista-dekning, LEAF/MODEL-Y 100 %, BMW 3 > 0 %', () => {
  execFileSync('node', ['--import', 'tsx', 'scripts/c95-finn-vehicle-intelligence.mjs'], { cwd: ROOT });
  const rep = JSON.parse(readFileSync(fileURLToPath(new URL('../scripts/out/c95-finn-vehicle-intelligence.json', import.meta.url)), 'utf8'));
  assert.equal(rep.meta.oppdrag.includes('topp 3'), true, 'kun topp 3 — ikke bygget bredt');
  const fam = Object.fromEntries(rep.familier.map((f) => [f.familie, f]));
  assert.ok(fam['BMW 3-SERIE'].annonser >= 200, 'BMW 3: finn-volum');
  assert.ok(fam['BMW 3-SERIE'].dekningsgrad > 0, 'BMW 3: Glavista ga kandidater (var 0 %)');
  assert.ok(fam['BMW 3-SERIE'].glavistaAndel > 0, 'BMW 3: kandidater via Glavista');
  assert.equal(fam.LEAF.dekningsgrad, 100, 'LEAF: 100 % dekning');
  assert.equal(fam['MODEL-Y'].dekningsgrad, 100, 'MODEL-Y: 100 % dekning');
});

test('C9.5-3: klassifisering — Glavista-kandidater er CLASS_D (foreslår, aldri EXACT)', () => {
  const gt = JSON.parse(readFileSync(fileURLToPath(new URL('../data/gt-ekspansjon/prisliste-alle-glass.json', import.meta.url)), 'utf8'));
  const classD = buildClassDCandidates(gt[0].results);
  const c = matchClassDCandidates(classD, 'NISSAN', 'LEAF', 2019);
  for (const k of c) assert.equal(k.klassifisering, 'CLASS_D_CATALOGUE_CANDIDATE');
});

test('C9.5-4: C8.2-analytics reflekterer C9.5-dekning — BMW 3-serie ikke lenger 100 % manuell', () => {
  execFileSync('node', ['--import', 'tsx', 'scripts/c82-evidence-analytics.mjs'], { cwd: ROOT });
  const rep = JSON.parse(readFileSync(fileURLToPath(new URL('../scripts/out/c82-evidence-analytics.json', import.meta.url)), 'utf8'));
  const bmw = rep.topp.find((r) => r.familie === '3-SERIE');
  assert.ok(bmw, '3-SERIE i TOPP');
  assert.ok(bmw.manuell < bmw.sok, '3-SERIE: ikke lenger alle manuelle (Glavista-union)');
  assert.ok(bmw.manglendeFeatures.length >= 1, '3-SERIE: skillende features kartlagt for evidenssamling');
});
