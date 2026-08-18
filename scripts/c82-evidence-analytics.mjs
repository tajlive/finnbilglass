/**
 * C8.2 — Evidence Analytics: TOPP 10 læringsmuligheter.
 * Kjører SVV-korpuset → per bil: applikasjon/kandidater (resolver + CLASS_D) → per familie:
 * søk, manuell, skillende features uten evidens, feilglass, verdifulle fixtures.
 * Kryss med finn.no-markedsvolum (C7.6) → læringsscore → «hvor skal C9.5 lete».
 * Katalog foreslår · Evidens bestemmer · Installasjon lærer. Ingen produksjonsendring.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { ApplicationResolver } from '../src/fitment-v1/application-resolver.js';
import { buildDefaultGenerationRegistry } from '../src/fitment-v1/generation-registry.js';
import { buildClassDCandidates, matchClassDCandidates } from '../src/fitment-v1/catalogue-candidates.js';
import { rankQuestions } from '../src/fitment-v1/question-optimizer.js';
import { EvidenceKernel } from '../src/fitment-v1/policy/kernel.js';
import { learningOpportunities } from '../src/learning-v1/analytics.js';

const OUT = resolve('scripts/out/c82-evidence-analytics.json');
const CORPUS = ['data/finn-modeller/svv-verifisert.ndjson', 'data/test-500-gt-detaljer.jsonl', '/Users/taj/bilglass/data/finn-no-regnr/svv-finn-broad-results.ndjson'];

// ── korpus (SVV truth) ──
const biler = [];
for (const f of CORPUS) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    biler.push({
      make: String(r.merke ?? r.make ?? r.brand ?? '').toUpperCase().replace('MERCEDES-BENZ', 'MERCEDES').replace('VOLKSWAGEN', 'VW'),
      model: String(r.modell ?? r.model ?? '').toUpperCase(),
      year: r.aar != null ? Number(r.aar) : r.year != null ? Number(r.year) : null,
    });
  }
}

// ── familie-mapping (samme som C9-benchmark) ──
const FAMS = {
  TRANSPORTER: /TRANSPORTER|MULTIVAN|CARAVELLE/, GOLF: /GOLF/, PASSAT: /PASSAT/, 'MODEL-3': /MODEL\s?3/,
  'MODEL-Y': /MODEL\s?Y/, LEAF: /LEAF/, RAV4: /RAV4|RAV\s?4/, '3-SERIE': /3-SERIE|3 SERIE|320|318|316/,
  XC60: /XC60/, SPRINTER: /SPRINTER/, VITO: /VITO/, COROLLA: /COROLLA/, '1-SERIE': /1-SERIE|1 SERIE|116|118|120/,
};
function famOf(b) {
  for (const [fam, re] of Object.entries(FAMS)) if (re.test(b.make + ' ' + b.model)) return fam;
  return null;
}

// ── markedsvolum (C7.6 finn.no-annonser) ──
const market = {};
try {
  const c76 = JSON.parse(readFileSync(resolve('scripts/out/c76-market-intelligence.json'), 'utf8'));
  for (const rad of c76.rows ?? c76.rapport ?? []) market[rad.familie] = rad.annonser ?? 0;
} catch { /* markedsdata valgfri */ }

const resolver = new ApplicationResolver({ families: buildDefaultGenerationRegistry() });
const gtRaw = JSON.parse(readFileSync('data/gt-ekspansjon/prisliste-alle-glass.json', 'utf8'));
const classD = buildClassDCandidates(gtRaw[0].results);
const kernel = new EvidenceKernel();
// C9.5: Glavista-kandidatindeks (frontruter) — dekker moderne BMW 3 (F30) som gt mangler
const glavistaRows = [];
for (const f of (() => { try { return readdirSync('data/scrape/glavista'); } catch { return []; } })()) {
  try {
    const j = JSON.parse(readFileSync('data/scrape/glavista/' + f, 'utf8'));
    if (String(j.produktgruppe ?? '').toLowerCase() !== 'windscreen') continue;
    glavistaRows.push({ modell: String(j.modell ?? ''), merke: String(j.merke ?? ''), eurokode: j.eurokode });
  } catch { /* hopp over korrupte filer */ }
}
const GLA_FAM = {
  '3-SERIE': { merke: 'BMW', re: /3ER/i, ekskluder: /X[1-7]|I[0-9]|IX|M[0-9]|Z[0-9]|4ER|5ER|8ER|2ER|Gran Turismo/i },
  LEAF: { merke: 'NISSAN', re: /LEAF/i, ekskluder: null },
  'MODEL-Y': { merke: 'TESLA', re: /MODEL\s?Y/i, ekskluder: null },
};
const GLA_ALIAS = { '3-SERIE': 'BMW 3-SERIE', LEAF: 'NISSAN LEAF', 'MODEL-Y': 'TESLA MODEL-Y' };

const vehicles = [];
for (const b of biler) {
  const fam = famOf(b) ?? null;
  if (!fam) continue; // kun kjente Tier 1-familier — analytics styrer C8/C9.5
  const apps = resolver.resolve({ make: b.make, model: b.model, modelYear: b.year }).applications;
  // Kandidatunion: evidens-kjernen (T5/CLA) + CLASS_D (katalog) + Glavista (C9.5: BMW 3 F30) — samme som C9-benchmark
  const kres = kernel.resolve({ registrationNumber: 'X', vin: null, make: b.make, model: b.model, modelYear: b.year });
  const classDCands = matchClassDCandidates(classD, b.make, b.model, b.year);
  const glaCands = (GLA_FAM[fam] ?? null)
    ? glavistaRows
        .filter((g) => g.merke.toUpperCase() === GLA_FAM[fam].merke && GLA_FAM[fam].re.test(g.modell))
        .filter((g) => (GLA_FAM[fam].ekskluder ? !GLA_FAM[fam].ekskluder.test(g.modell) : true))
    : [];
  const union = new Map();
  for (const c of kres.candidates ?? []) union.set(c.eurokode ?? c.varenr, { features: c.features ?? [] });
  for (const c of classDCands) if (!union.has(c.eurokode)) union.set(c.eurokode, { features: c.features ?? [] });
  for (const g of glaCands) if (!union.has(g.eurokode)) union.set(g.eurokode, { features: [] });
  const cands = [...union.values()];
  let skillende = [];
  if (cands.length > 1) {
    skillende = rankQuestions(cands.map((c) => ({ features: c.features, glavista: null, variant: null }))).map((r) => r.feature);
  }
  vehicles.push({ make: b.make, model: b.model, year: b.year, familie: fam, kandidater: cands.length, skillendeFeatures: skillende });
}

// ── fixtures (i dag 0; ledger-integrasjon når installasjoner akkumuleres) ──
const fixtures = {};

const rapport = learningOpportunities(vehicles, market, fixtures);
const report = {
  meta: { generatedAt: new Date().toISOString(), korpus: vehicles.length, prinsipp: 'Læringsmuligheter = markedsvolum × manuell-gap × evidence-mangel. Katalog foreslår, evidens bestemmer.' },
  topp: rapport,
  oppsummering: {
    familierMedKandidater: new Set(vehicles.filter((v) => v.kandidater > 0).map((v) => v.familie)).size,
    familierUtenKandidater: new Set(vehicles.filter((v) => v.kandidater === 0).map((v) => v.familie)).size,
    manglendeFeaturesUnike: [...new Set(rapport.flatMap((r) => r.manglendeFeatures))].sort(),
  },
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ topp: rapport.map((r) => `${r.rang}. ${r.familie}: ${r.sok} søk, ${r.manuell} manuell, mangler ${r.manglendeFeatures.join('/') || '—'}`) }, null, 1));
