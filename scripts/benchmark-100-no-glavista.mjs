#!/usr/bin/env node
/**
 * 100-car offline regression benchmark against the repository's own SQL price-list.
 *
 * No HTTP, SVV, Glavista, Steklo-Lux, live D1 or customer actions.
 * Reads the FIRST 100 rows of data/finn-100.jsonl (source currently contains 110).
 * Does not emit registration numbers, VINs, Finn IDs or per-vehicle results.
 *
 * Metrics are catalogue CANDIDATE coverage only, not verified fitment accuracy.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ApplicationResolver } from '../src/fitment-v1/application-resolver.js';
import { buildDefaultGenerationRegistry } from '../src/fitment-v1/generation-registry.js';
import { buildClassDCandidates, matchClassDCandidates } from '../src/fitment-v1/catalogue-candidates.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SAMPLE_COUNT = 100;
const SOURCE = join(ROOT, 'data/finn-100.jsonl');
const SQL_DIR = join(ROOT, 'db/katalog');

export function runOffline100Benchmark() {
  const allVehicles = readFileSync(SOURCE, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  if (allVehicles.length < SAMPLE_COUNT) throw new Error('Need >=100 source vehicles');
  const sampled = allVehicles.slice(0, SAMPLE_COUNT);
  if (new Set(sampled.map((x) => x.regnr)).size !== SAMPLE_COUNT) {
    throw new Error('First 100 source cars have duplicate registration numbers');
  }
  const priceListFiles = readdirSync(SQL_DIR).filter((name) => /^prisliste_insert_\d{2}\.sql$/.test(name)).sort();
  if (priceListFiles.length !== 6) throw new Error('Expected six committed SQL price-list files');

  // No network is needed or permitted. The only database is in-memory SQLite.
  const db = new DatabaseSync(':memory:');
  let sourceRows = [];
  let totalSourceRows = 0;
  try {
    db.exec(readFileSync(join(ROOT, 'db/schema-katalog.sql'), 'utf8'));
    for (const file of priceListFiles) db.exec(readFileSync(join(SQL_DIR, file), 'utf8'));
    totalSourceRows = db.prepare('SELECT COUNT(*) AS n FROM glass_prisliste').get().n;
    sourceRows = db.prepare(
      "SELECT varenr, varenavn, kommentar, eurokode FROM glass_prisliste WHERE rad_type = 'glass'"
    ).all();
  } finally {
    db.close();
  }

  const index = buildClassDCandidates(sourceRows);
  const resolver = new ApplicationResolver({ families: buildDefaultGenerationRegistry() });
  const stats = {
    sourceVehicles: allVehicles.length,
    evaluatedVehicles: sampled.length,
    excludedAfterFirst100: allVehicles.length - sampled.length,
    inputCompleteness: 0,
    catalogueSqlFiles: priceListFiles.length,
    catalogueAllRows: totalSourceRows,
    catalogueGlassRows: sourceRows.length,
    indexedCandidateRows: index.length,
    applicationCandidates: 0,
    withGlassCandidates: 0,
    withoutGlassCandidates: 0,
    exactlyOneCandidate: 0,
    multipleCandidates: 0,
    candidateRowsReturned: 0,
    uniqueCandidateEurocodes: 0,
    missingEurocodeRows: 0,
    suspiciousNonWindshieldCodes: 0,
    knownOtherGlassPositionCodes: 0,
    unclassifiedEurocodeFormats: 0,
    candidateWithEquipmentEvidence: 0,
    autoExactApproved: 0,
    independentVehicleToOEProof: 0,
    vehicleFitmentFalsePositiveRateMeasured: false,
    noNetworkOrGlavistaUsed: true,
    newFamiliesObserved: { ASX: 0, 'CX-5': 0, 'FIAT-500': 0, 'FIAT-500-ELECTRIC': 0, 'VW-UP': 0 },
    noCandidateBrands: {},
  };
  const seenEuro = new Set();
  for (const v of sampled) {
    if (!v.merke || !v.modell || !Number.isInteger(Number(v.aar))) continue;
    stats.inputCompleteness++;
    const make = String(v.merke).toUpperCase().replace('VOLKSWAGEN', 'VW').replace('MERCEDES-BENZ', 'MERCEDES').trim();
    const model = String(v.modell).toUpperCase().split(',')[0].trim();
    const year = Number(v.aar);
    const applications = resolver.resolve({ make, model, modelYear: year }).applications;
    if (applications.length) stats.applicationCandidates++;

    const matches = matchClassDCandidates(index, make, model, year);
    if (!matches.length) {
      stats.withoutGlassCandidates++;
      stats.noCandidateBrands[make] = (stats.noCandidateBrands[make] ?? 0) + 1;
      continue;
    }
    stats.withGlassCandidates++;
    if (matches.length === 1) stats.exactlyOneCandidate++;
    else stats.multipleCandidates++;
    stats.candidateRowsReturned += matches.length;
    for (const c of matches) {
      if (c.klassifisering !== 'CLASS_D_CATALOGUE_CANDIDATE') {
        throw new Error('Unexpected authoritative catalogue class');
      }
      if (!c.eurokode) stats.missingEurocodeRows++;
      else {
        seenEuro.add(c.eurokode);
        if (!/^\\d{3,5}A[A-Z0-9]/i.test(c.eurokode)) stats.suspiciousNonWindshieldCodes++;
        const position = c.eurokode.trim().toUpperCase().match(/^\\d{3,5}([ABFLRS])/);
        if (position && position[1] !== 'A') stats.knownOtherGlassPositionCodes++;
        if (!position) stats.unclassifiedEurocodeFormats++;
      }
      if (c.features.length) stats.candidateWithEquipmentEvidence++;
    }
    // Recorded per vehicle as aggregate only. New families can be matched from our catalogue,
    // but NO newly found match proves vehicle-specific glass fitment.
    if (make === 'MITSUBISHI' && /^ASX\b/.test(model)) stats.newFamiliesObserved.ASX++;
    if (make === 'MAZDA' && /^CX-?5\b/.test(model)) stats.newFamiliesObserved['CX-5']++;
    if (make === 'FIAT' && /^500(?:E|\s+ELECTRIC)\b/.test(model)) stats.newFamiliesObserved['FIAT-500-ELECTRIC']++;
    else if (make === 'FIAT' && /^500\b/.test(model)) stats.newFamiliesObserved['FIAT-500']++;
    if (make === 'VW' && /^UP!?\b/.test(model)) stats.newFamiliesObserved['VW-UP']++;
  }
  stats.uniqueCandidateEurocodes = seenEuro.size;
  if (stats.inputCompleteness !== SAMPLE_COUNT) throw new Error('Missing make, model or year in sample');
  if (stats.withGlassCandidates + stats.withoutGlassCandidates !== SAMPLE_COUNT) {
    throw new Error('Coverage accounting does not equal 100');
  }
  if (stats.autoExactApproved !== 0) throw new Error('Catalogue data must not auto-approve EXACT');
  if (stats.knownOtherGlassPositionCodes !== 0) throw new Error('Side/rear/vent codes must not be returned as windscreens');
  return {
    baseline: '2026-11-15-finn-100-first100',
    evaluatedCommit: process.env.GITHUB_SHA ?? 'local',
    definition: 'offline candidate coverage (NOT fitment accuracy)',
    stats,
    rates: {
      candidateCoveragePct: Number((stats.withGlassCandidates / SAMPLE_COUNT * 100).toFixed(1)),
      applicationCandidateCoveragePct: Number((stats.applicationCandidates / SAMPLE_COUNT * 100).toFixed(1)),
      multiCandidateAmongCoveredPct: stats.withGlassCandidates
        ? Number((stats.multipleCandidates / stats.withGlassCandidates * 100).toFixed(1)) : 0,
    },
    limitations: [
      'No independent OE, vehicle build data or photo for these 100 rows; fitment accuracy cannot be measured.',
      'Source first100 is order-dependent; the source file currently includes more than 100 rows.',
      'The own SQL catalogue is historical; rights and current availability must be independently confirmed.',
      'Model/years and catalogue rows can yield multiple variants and false candidates; all require staff verification.',
      'No Steklo-Lux or Glavista retrieval is performed by this benchmark.',
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runOffline100Benchmark();
  console.log('FBG100_RESULT_JSON=' + JSON.stringify(result));
}
