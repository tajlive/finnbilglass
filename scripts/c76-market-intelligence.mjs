/**
 * C7.6 — Market Intelligence Layer.
 * Finn.no = MARKET DEMAND SIGNAL (aldri sannhet). Kryss: markedsvolum × data-gap → ROI-prioritet
 * for Application→OE-anskaffelse (TecDoc/EPC). Basert på: finn-annonser (marked), SVV-korpus (truth),
 * CLASS_D-kandidater (catalogue-candidates). Kjøp aldri data blindt.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { ApplicationResolver } from '../src/fitment-v1/application-resolver.js';
import { buildDefaultGenerationRegistry } from '../src/fitment-v1/generation-registry.js';
import { buildClassDCandidates, matchClassDCandidates } from '../src/fitment-v1/catalogue-candidates.js';
import { FAMILIER } from '../src/fitment-v1/catalogue-candidates.js';

const OUT = resolve('scripts/out/c76-market-intelligence.json');

// ── 1) Finn.no-annonser = markedsindikator ──
const FINN_FILES = [
  'data/finn-100.jsonl',
  'data/finn-modeller/svv-verifisert.ndjson',
  'data/finn-modeller/tesla-model-3-annonser.ndjson',
  'data/finn-modeller/toyota-corolla-annonser.ndjson',
  'data/finn-modeller/toyota-hilux-annonser.ndjson',
  'data/finn-modeller/toyota-rav4-annonser.ndjson',
  'data/finn-modeller/vw-caravelle-annonser.ndjson',
  'data/finn-modeller/vw-transporter-annonser.ndjson',
  '/Users/taj/bilglass/data/finn-no-regnr/broad-scrape-2026-06-07.ndjson',
];
const market = new Map(); // familie → antall annonser
let marketAds = 0;
for (const f of FINN_FILES) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    const make = String(r.merke ?? r.brand ?? r.make ?? '').toUpperCase().replace('MERCEDES-BENZ', 'MERCEDES').replace('VOLKSWAGEN', 'VW');
    const model = String(r.modell ?? r.model ?? '').toUpperCase();
    const fam = FAMILIER.find((x) => x.merke === make && x.re.test(model));
    if (!fam) continue;
    marketAds++;
    market.set(fam.familie, (market.get(fam.familie) ?? 0) + 1);
  }
}

// ── 2) SVV-korpus (truth) + CLASS_D-kandidater (candidate) per familie ──
const resolver = new ApplicationResolver({ families: buildDefaultGenerationRegistry() });
const gtRaw = JSON.parse(readFileSync('data/gt-ekspansjon/prisliste-alle-glass.json', 'utf8'));
const classDIndex = buildClassDCandidates(gtRaw[0].results);

const truth = new Map(); // familie → {svvBiler, medApplikasjon, medKandidater}
const CORPUS = [
  'data/finn-modeller/svv-verifisert.ndjson',
  'data/test-500-gt-detaljer.jsonl',
  '/Users/taj/bilglass/data/finn-no-regnr/svv-finn-broad-results.ndjson',
];
for (const f of CORPUS) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    const make = String(r.merke ?? r.make ?? r.brand ?? '').toUpperCase().replace('MERCEDES-BENZ', 'MERCEDES').replace('VOLKSWAGEN', 'VW');
    const model = String(r.modell ?? r.model ?? '').toUpperCase();
    const year = r.aar != null ? Number(r.aar) : r.year != null ? Number(r.year) : null;
    const fam = FAMILIER.find((x) => x.merke === make && x.re.test(model));
    if (!fam) continue;
    const t = truth.get(fam.familie) ?? { svvBiler: 0, medApplikasjon: 0, medKandidater: 0 };
    t.svvBiler++;
    if (resolver.resolve({ make, model, modelYear: year }).applications.length > 0) t.medApplikasjon++;
    if (matchClassDCandidates(classDIndex, make, model, year).length > 0) t.medKandidater++;
    truth.set(fam.familie, t);
  }
}

// ── 3) ROI-prioritet: markedsvolum × data-gap ──
const rows = [];
for (const [familie, ads] of market) {
  const t = truth.get(familie) ?? { svvBiler: 0, medApplikasjon: 0, medKandidater: 0 };
  const appGapPct = t.svvBiler > 0 ? Math.round(((t.svvBiler - t.medApplikasjon) / t.svvBiler) * 100) : 100;
  const oeGap = t.svvBiler > 0 && t.medKandidater > 0 ? Math.round(((t.medKandidater - 0) / t.svvBiler) * 100) : 0;
  const roi = Math.round(ads * (appGapPct / 100) * 10) / 10;
  rows.push({ familie, marketAds: ads, svvBiler: t.svvBiler, applikasjonsGapPct: appGapPct, oeGapPct: oeGap, roiScore: roi });
}
rows.sort((a, b) => b.roiScore - a.roiScore);

const report = {
  meta: { generatedAt: new Date().toISOString(), marketAds: marketAds, prinsipp: 'Finn.no = markedsignal, aldri sannhet. SVV = truth. Katalog = kandidater. Kun evidens gir EXACT.' },
  marketCoverage: [...market.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([f, n]) => ({ familie: f, annonser: n })),
  roiPriority: rows.slice(0, 15),
  tecdocBuyRecommendation: rows.filter((r) => r.roiScore >= 50).map((r) => ({ familie: r.familie, roiScore: r.roiScore, why: `${r.marketAds} annonser × ${r.applikasjonsGapPct}% applikasjons-gap` })),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ marketAds, roiTop: report.roiPriority.slice(0, 8), buy: report.tecdocBuyRecommendation }, null, 1));
