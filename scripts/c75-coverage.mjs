/**
 * C7.5 — Catalogue Candidate Expansion & Coverage Measurement.
 * Måler på SVV-korpuset: applikasjon (generasjonsregister) → CLASS_D-kandidater (gt-prisliste).
 * Output: GLASS_COVERAGE før/etter, saker som stopper på Application→OE, TecDoc/EPC-kravliste.
 * Katalogdata = KUN kandidater (CLASS_D_CATALOGUE_CANDIDATE), aldri fasit. Personvern: kun hash.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { ApplicationResolver } from '../src/fitment-v1/application-resolver.js';
import { buildDefaultGenerationRegistry } from '../src/fitment-v1/generation-registry.js';
import { buildClassDCandidates, matchClassDCandidates } from '../src/fitment-v1/catalogue-candidates.js';

const SALT = process.env.C6_SALT || 'finnbilglass-c6-dev-salt';
const CORPUS_FILES = [
  'data/finn-modeller/svv-verifisert.ndjson',
  'data/test-500-gt-detaljer.jsonl',
  'data/finn-100.jsonl',
  '/Users/taj/bilglass/data/finn-no-regnr/svv-finn-broad-results.ndjson',
];
const OUT = resolve('scripts/out/c75-coverage.json');

const hash = (id) => createHash('sha256').update(`${id}::${SALT}`).digest('hex').slice(0, 16);

// korpus
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
      make: String(r.merke ?? r.make ?? r.brand ?? '').toUpperCase().replace('MERCEDES-BENZ', 'MERCEDES').replace('VOLKSWAGEN', 'VW'),
      model: String(r.modell ?? r.model ?? '').toUpperCase(),
      year: r.aar != null ? Number(r.aar) : r.year != null ? Number(r.year) : null,
    });
  }
}

function normalizeModel(v) {
  let mo = v.model;
  const toks = mo.split(/\s+/);
  if (toks[0] === v.make) mo = toks.slice(1).join(' ');
  mo = mo.split(',')[0].trim().replace(/\d+\s*KW/i, '').replace(/\s*-\s*$/, '').trim();
  return mo;
}

// CLASS_D-kandidatindeks fra gt-prislisten
const gtRaw = JSON.parse(readFileSync('data/gt-ekspansjon/prisliste-alle-glass.json', 'utf8'));
const index = buildClassDCandidates(gtRaw[0].results);
console.log('gt-rader:', gtRaw[0].results.length, '| CLASS_D-indeks:', index.length);

const resolver = new ApplicationResolver({ families: buildDefaultGenerationRegistry() });

// per-familie-akkumulator (kun høyvolumfamilier med kandidatpotensial)
const perFamily = new Map();
const totals = { vehicles: corpus.length, application: 0, withCandidates: 0, multiCandidate: 0, stopsAtOe: 0 };

for (const v of corpus) {
  const facts = { make: v.make, model: normalizeModel(v), modelYear: v.year };
  const apps = resolver.resolve(facts).applications;
  const cands = matchClassDCandidates(index, v.make, normalizeModel(v), v.year);
  if (apps.length > 0) totals.application++;
  if (cands.length > 0) {
    totals.withCandidates++;
    if (cands.length > 1) totals.multiCandidate++;
    totals.stopsAtOe++; // kandidater finnes, men ingen autoritativ applikasjon→OE-kant
  }
  const famKey = apps[0]?.generation ?? `${v.make} ${normalizeModel(v).split(' ')[0]}`;
  const f = perFamily.get(famKey) ?? { family: famKey, vehicles: 0, withCandidates: 0 };
  f.vehicles++; if (cands.length > 0) f.withCandidates++;
  perFamily.set(famKey, f);
}

const n = corpus.length;
const report = {
  meta: { generatedAt: new Date().toISOString(), vehicles: n, privacy: 'kun sha256-hash', klassifisering: 'CLASS_D_CATALOGUE_CANDIDATE — aldri fasit, aldri EXACT, aldri automatisk OE-aksept' },
  coverage: {
    applicationCoverage: Math.round((totals.application / n) * 1000) / 10,
    glassCoverageBefore: Math.round((totals.application / n) * 1000) / 10,
    glassCoverageAfterClassD: Math.round((totals.withCandidates / n) * 1000) / 10,
    multiCandidateShare: Math.round((totals.multiCandidate / Math.max(1, totals.withCandidates)) * 1000) / 10,
    stopsAtApplicationToOe: totals.stopsAtOe,
  },
  perFamily: [...perFamily.values()].sort((a, b) => b.vehicles - a.vehicles).slice(0, 20),
  tecdocRequirement: {
    rationale: 'Saker med kandidater men ingen autoritativ Application→OE-kant krever TecDoc/EPC (eller kunde-OE/foto).',
    familiesNeedingOeData: [...perFamily.values()].filter((f) => f.vehicles >= 10 && f.withCandidates > 0).sort((a, b) => b.vehicles - a.vehicles).slice(0, 12).map((f) => ({ family: f.family, vehicles: f.vehicles, candidatesFound: f.withCandidates })),
  },
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ coverage: report.coverage, topFamilies: report.perFamily.slice(0, 8), tecdoc: report.tecdocRequirement.familiesNeedingOeData.slice(0, 6) }, null, 1));
