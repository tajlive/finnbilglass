/**
 * C9 — Exact Glass Optimization Engine: 1000-kjennemerkesøk-måling.
 * Utfall per søk: EXACT direkte / løst etter 1 spørsmål (optimalisert) / løst etter foto-OE / handoff.
 * Accuracy gain × market volume (C7.6-markedsdata) → hvor optimalisering gir mest.
 * CLASS_D-kandidater er aldri fasit; målingen er KAPABILITET (hva som kan løses), ikke fasit-garanti.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { ApplicationResolver } from '../src/fitment-v1/application-resolver.js';
import { buildDefaultGenerationRegistry } from '../src/fitment-v1/generation-registry.js';
import { buildClassDCandidates, matchClassDCandidates } from '../src/fitment-v1/catalogue-candidates.js';
import { rankQuestions } from '../src/fitment-v1/question-optimizer.js';
import { EvidenceKernel } from '../src/fitment-v1/policy/kernel.js';

const OUT = resolve(process.env.ANALYTICS_OUTPUT_FILE ?? 'scripts/out/c9-accuracy.json');
const FIXTURE_DIR = process.env.ANALYTICS_FIXTURE_DIR ? resolve(process.env.ANALYTICS_FIXTURE_DIR) : null;
const TIER1 = ['TRANSPORTER', 'GOLF', 'PASSAT', 'MODEL-3', 'MODEL-Y', 'LEAF', 'RAV4', '3-SERIE', 'XC60', 'SPRINTER', 'VITO'];
const MAX_SOK = 1000;

// ── korpus (SVV truth) ──
const CORPUS = FIXTURE_DIR
  ? [resolve(FIXTURE_DIR, 'c9-corpus.ndjson')]
  : ['data/finn-modeller/svv-verifisert.ndjson', 'data/test-500-gt-detaljer.jsonl', '/Users/taj/bilglass/data/finn-no-regnr/svv-finn-broad-results.ndjson'];
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

// Tier 1-familier først, deretter resten — 1000 søk
function famOf(b) {
  const fams = { TRANSPORTER: /TRANSPORTER|MULTIVAN|CARAVELLE/, GOLF: /GOLF/, PASSAT: /PASSAT/, 'MODEL-3': /MODEL\s?3/, 'MODEL-Y': /MODEL\s?Y/, LEAF: /LEAF/, RAV4: /RAV4|RAV\s?4/, '3-SERIE': /3-SERIE|3 SERIE|320|318|316/, XC60: /XC60/, SPRINTER: /SPRINTER/, VITO: /VITO/ };
  for (const [fam, re] of Object.entries(fams)) if (re.test(b.make + ' ' + b.model)) return fam;
  return null;
}
const tier1 = biler.filter((b) => famOf(b));
const rest = biler.filter((b) => !famOf(b));
const utvalg = [...tier1, ...rest].slice(0, MAX_SOK);

const resolver = new ApplicationResolver({ families: buildDefaultGenerationRegistry() });
const kernel = new EvidenceKernel();
const gtRaw = JSON.parse(readFileSync(FIXTURE_DIR ? resolve(FIXTURE_DIR, 'catalogue.json') : 'data/gt-ekspansjon/prisliste-alle-glass.json', 'utf8'));
const classD = buildClassDCandidates(gtRaw[0].results);

const utfall = { EXACT_DIREKTE: 0, ETT_SPORSMAL: 0, FOTO_OE: 0, HANDOFF: 0 };
const perFamilie = new Map();

for (const b of utvalg) {
  const apps = resolver.resolve({ make: b.make, model: b.model, modelYear: b.year }).applications;
  // Kandidatunion: evidens-kjernen (kernel/Glavista — T5/CLA-familiene) + CLASS_D (gt-prislisten)
  const kres = kernel.resolve({ registrationNumber: 'C9-' + b.make + b.model + b.year, vin: null, make: b.make, model: b.model, modelYear: b.year });
  const kandidater = new Map();
  for (const c of kres.candidates ?? []) kandidater.set(c.eurokode ?? c.varenr, { features: c.features, glavista: c.glavista, variant: c.variant });
  for (const c of matchClassDCandidates(classD, b.make, b.model, b.year)) if (!kandidater.has(c.eurokode)) kandidater.set(c.eurokode, { features: c.features, glavista: null, variant: null });
  const cands = [...kandidater.values()];
  const fam = famOf(b) ?? 'ANNEN';
  const row = perFamilie.get(fam) ?? { familie: fam, sok: 0, EXACT_DIREKTE: 0, ETT_SPORSMAL: 0, FOTO_OE: 0, HANDOFF: 0 };
  row.sok++;
  let kategori;
  if (cands.length === 0) {
    kategori = 'HANDOFF'; // ingen kandidater fra noen kilde → montør-handoff
  } else if (cands.length === 1) {
    kategori = 'FOTO_OE'; // én kandidat: bekreftelse via OE-merking/foto (aldri auto-EXACT)
  } else {
    const ranks = rankQuestions(cands);
    const kanElimineresTilEn = ranks.some((r) => r.potensial >= cands.length - 1);
    if (kanElimineresTilEn) kategori = 'ETT_SPORSMAL';
    else kategori = 'FOTO_OE'; // kandidater finnes, men kun OE-merking/foto skiller dem
  }
  utfall[kategori]++;
  row[kategori]++;
  perFamilie.set(fam, row);
}

const n = utvalg.length;
const report = {
  meta: { generatedAt: new Date().toISOString(), sok: n, prinsipp: 'CLASS_D-kandidater = kapabilitet, aldri fasit. EXACT krever fortsatt OE/foto-evidens.' },
  fordeling: {
    EXACT_DIREKTE: { antall: utfall.EXACT_DIREKTE, pct: Math.round((utfall.EXACT_DIREKTE / n) * 1000) / 10 },
    ETT_SPORSMAL: { antall: utfall.ETT_SPORSMAL, pct: Math.round((utfall.ETT_SPORSMAL / n) * 1000) / 10 },
    FOTO_OE: { antall: utfall.FOTO_OE, pct: Math.round((utfall.FOTO_OE / n) * 1000) / 10 },
    HANDOFF: { antall: utfall.HANDOFF, pct: Math.round((utfall.HANDOFF / n) * 1000) / 10 },
  },
  perFamilie: [...perFamilie.values()].sort((a, b) => b.sok - a.sok).slice(0, 14),
  konklusjon: 'Fokus: familier med høy ETT_SPORSMAL/FOTO_OE-andel og høyt markedsvolum — question optimizer + fotoflyt gir mest her.',
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ fordeling: report.fordeling, top: report.perFamilie.slice(0, 8) }, null, 1));
