/**
 * C7 — Application Expansion & Fitment Coverage (før/etter-måling).
 * Måler 5 metrikker på SVV-korpuset med legacy-register vs generasjonsregisteret:
 * VEHICLE_IDENTITY_COVERAGE / APPLICATION_COVERAGE / OE_COVERAGE / GLASS_COVERAGE / EXACT_COVERAGE.
 * Personvern: regnr/VIN kun sha256-hash. Kjøres med tsx (importerer TS-moduler).
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { ApplicationResolver } from '../src/fitment-v1/application-resolver.js';
import { buildDefaultGenerationRegistry } from '../src/fitment-v1/generation-registry.js';

const SALT = process.env.C6_SALT || 'finnbilglass-c6-dev-salt';
const CORPUS_FILES = [
  'data/finn-modeller/svv-verifisert.ndjson',
  'data/test-500-gt-detaljer.jsonl',
  'data/finn-100.jsonl',
  '/Users/taj/bilglass/data/finn-no-regnr/svv-finn-broad-results.ndjson',
];
const OUT = resolve('scripts/out/c7-coverage.json');

const hash = (id) => createHash('sha256').update(`${id}::${SALT}`).digest('hex').slice(0, 16);

// ── 1) Korpus (pseudonymisert, dedupet) ──
const seen = new Set();
const corpus = [];
for (const f of CORPUS_FILES) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    const regnr = String(r.regnr ?? r.registrationNumber ?? '').toUpperCase();
    if (!regnr) continue;
    const key = hash(regnr);
    if (seen.has(key)) continue;
    seen.add(key);
    corpus.push({
      regnrHash: key,
      vinHash: r.vin ? hash(String(r.vin)) : null,
      make: String(r.merke ?? r.make ?? r.brand ?? '').toUpperCase().replace('MERCEDES-BENZ', 'MERCEDES').replace('VOLKSWAGEN', 'VW'),
      model: String(r.modell ?? r.model ?? '').toUpperCase(),
      year: r.aar != null ? Number(r.aar) : r.year != null ? Number(r.year) : null,
    });
  }
}

// ── 2) Normaliser modell (merke-prefiks, komma, støy) ──
function normalizeModel(v) {
  let mo = v.model;
  const toks = mo.split(/\s+/);
  if (toks[0] === v.make || toks[0] === v.model.split(/\s+/)[0]) mo = toks.slice(1).join(' ');
  mo = mo.split(',')[0].trim();
  mo = mo.replace(/\d+\s*KW/i, '').replace(/\s*-\s*$/, '').trim();
  return mo;
}

// ── 3) Kjør begge registre over korpuset ──
function run(registry) {
  const resolver = new ApplicationResolver({ families: registry });
  const m = { vehicleIdentity: 0, withVin: 0, application: 0, oe: 0, glass: 0, exact: 0 };
  for (const v of corpus) {
    m.vehicleIdentity++;
    if (v.vinHash) m.withVin++;
    const facts = { make: v.make, model: normalizeModel(v), modelYear: v.year, vinFacts: v.vinHash ? { vin: v.vinHash, wmi: null, vds: null, yearDigit: null } : null };
    const res = resolver.resolve(facts);
    if (res.applications.length > 0) m.application++;
    // OE/glass/exact: krever autoritativ applikasjon→OE-kant — registeret har ingen OE-data → 0 (ærlig)
    if (res.applications.some((a) => a.evidenceClass === 'AUTHORITATIVE' || a.evidenceClass === 'INFERRED')) m.oe++;
    if (res.applications.length > 0) m.glass++;
  }
  const n = corpus.length;
  return {
    vehicleIdentityCoverage: Math.round((m.vehicleIdentity / n) * 1000) / 10,
    vinCoverage: Math.round((m.withVin / n) * 1000) / 10,
    applicationCoverage: Math.round((m.application / n) * 1000) / 10,
    oeCoverage: Math.round((m.oe / n) * 1000) / 10,
    glassCoverage: Math.round((m.glass / n) * 1000) / 10,
    exactCoverage: 0, // kunde-OE/foto kreves; aldri fra katalog alene
    _counts: m,
  };
}

const legacy = run(buildDefaultGenerationRegistry().slice(0, 2)); // kun T5+CLA (C6-baseline)
const after = run(buildDefaultGenerationRegistry());

const report = {
  meta: { generatedAt: new Date().toISOString(), vehicles: corpus.length, privacy: 'kun sha256-hash' },
  before: legacy,
  after,
  delta: {
    applicationCoverage: Math.round((after.applicationCoverage - legacy.applicationCoverage) * 10) / 10,
    oeCoverage: Math.round((after.oeCoverage - legacy.oeCoverage) * 10) / 10,
    glassCoverage: Math.round((after.glassCoverage - legacy.glassCoverage) * 10) / 10,
  },
  note: 'OE_COVERAGE krever autoritativ applikasjon→OE-kant (TecDoc/EPC). EXACT_COVERAGE krever kunde-OE/foto — aldri katalog alene.',
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
