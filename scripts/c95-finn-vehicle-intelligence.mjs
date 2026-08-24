/**
 * C9.5 Phase 1 — Finn Vehicle Intelligence (topp 3: BMW 3-SERIE, NISSAN LEAF, TESLA MODEL-Y).
 * Finn-annonser (regnr) → SVV-verifisert bil → kandidatgenerering (gt CLASS_D ∪ Glavista) →
 * dekning/evidens-gap per familie → «hvor C9.5 skal lete» (C8.2-utgangspunkt).
 * REGLER: Finn = markedssensor, aldri sannhet. Katalog/Glavista = kandidater, aldri EXACT.
 * Glavista beviser OE→glass, IKKE at bilen har OE. Ingen produksjonsendring.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { buildClassDCandidates, matchClassDCandidates } from '../src/fitment-v1/catalogue-candidates.js';
import { rankQuestions } from '../src/fitment-v1/question-optimizer.js';

const OUT = resolve(process.env.ANALYTICS_OUTPUT_FILE ?? 'scripts/out/c95-finn-vehicle-intelligence.json');
const FIXTURE_DIR = process.env.ANALYTICS_FIXTURE_DIR ? resolve(process.env.ANALYTICS_FIXTURE_DIR) : null;
const FINN = FIXTURE_DIR ? resolve(FIXTURE_DIR, 'c95-finn.ndjson') : '/Users/taj/bilglass/data/finn-no-regnr/broad-scrape-2026-06-07.ndjson';
const SVV = FIXTURE_DIR ? resolve(FIXTURE_DIR, 'c95-svv.ndjson') : '/Users/taj/bilglass/data/finn-no-regnr/svv-finn-broad-results.ndjson';

// ── topp 3-familie-regler: SVV-modell-token + Glavista-modellnavn-token ──
const FAMILIER = {
  'BMW 3-SERIE': { svvRe: /3|316|318|320|325|328|330|335/i, glavistaRe: /3ER/i, ekskluder: /X[1-7]|I[0-9]|IX|M[0-9]|Z[0-9]|4ER|5ER|8ER|2ER/i },
  LEAF: { svvRe: /LEAF/i, glavistaRe: /LEAF/i, ekskluder: null },
  'MODEL-Y': { svvRe: /MODEL\s?Y/i, glavistaRe: /MODEL\s?Y/i, ekskluder: null },
};

function aarFraFraNavn(glavistaModell) {
  const m = String(glavistaModell ?? '').match(/\b(19|20)\d{2}\s*[-–]?/);
  return m ? parseInt(m[0].replace(/[-–]/, '').trim(), 10) : null;
}

// ── last annonser + SVV-svar ──
const annonser = existsSync(FINN) ? readFileSync(FINN, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
const svvMap = new Map();
if (existsSync(SVV)) {
  for (const l of readFileSync(SVV, 'utf8').split('\n').filter(Boolean)) {
    let r; try { r = JSON.parse(l); } catch { continue; }
    svvMap.set(String(r.regnr).toUpperCase(), r);
  }
}

// ── gt + Glavista-kandidatindekser ──
const gt = JSON.parse(readFileSync(FIXTURE_DIR ? resolve(FIXTURE_DIR, 'catalogue.json') : 'data/gt-ekspansjon/prisliste-alle-glass.json', 'utf8'));
const classD = buildClassDCandidates(gt[0].results);
const glavistaRows = [];
const glavistaDir = FIXTURE_DIR ? resolve(FIXTURE_DIR, 'glavista') : 'data/scrape/glavista';
for (const f of readdirSyncSafe(glavistaDir)) {
  try {
    const j = JSON.parse(readFileSync(resolve(glavistaDir, f), 'utf8'));
    if (String(j.produktgruppe ?? '').toLowerCase() !== 'windscreen') continue;
    glavistaRows.push({ modell: String(j.modell ?? ''), merke: String(j.merke ?? ''), oe: Array.isArray(j.oeNummer) ? j.oeNummer : [], eurokode: j.eurokode, aarFra: aarFraFraNavn(j.modell) });
  } catch { /* hopp over korrupte filer */ }
}

function readdirSyncSafe(p) {
  try { return readdirSync(p); } catch { return []; }
}

// ── per annonse: SVV-verifiser → topp 3 → kandidater ──
const perFamilie = new Map();
for (const a of annonser) {
  const svv = svvMap.get(String(a.regnr).toUpperCase());
  if (!svv) continue;
  const mk = String(svv.make ?? '').toUpperCase();
  const mo = String(svv.model ?? '').toUpperCase();
  const fam = Object.entries(FAMILIER).find(([, r]) => r.svvRe.test(mk + ' ' + mo))?.[0];
  if (!fam) continue;
  const regler = FAMILIER[fam];
  if (regler.ekskluder && regler.ekskluder.test(mk + ' ' + mo)) continue;

  const gtCands = matchClassDCandidates(classD, mk, mo, svv.year ?? null);
  const glaCands = glavistaRows
    .filter((g) => String(g.merke).toUpperCase() === mk && regler.glavistaRe.test(g.modell))
    .filter((g) => regler.ekskluder ? !regler.ekskluder.test(g.modell) : true)
    .filter((g) => svv.year == null || g.aarFra == null || svv.year >= g.aarFra)
    .filter((g) => !gtCands.some((c) => c.eurokode === g.eurokode)); // union, ingen duplikater

  const union = [...gtCands, ...glaCands.map((g) => ({ eurokode: g.eurokode, varenr: g.eurokode, varenavn: g.modell, features: [], source: 'GLAVISTA', klassifisering: 'CLASS_D_CATALOGUE_CANDIDATE', matchReason: `${mk} ${fam} Glavista` }))];
  const skillende = union.length > 1 ? rankQuestions(union.map((c) => ({ features: c.features, glavista: null, variant: null }))).map((r) => r.feature) : [];

  const weight = FIXTURE_DIR ? Number(a.testWeight ?? 1) : 1;
  const r = perFamilie.get(fam) ?? { familie: fam, annonser: 0, medKandidater: 0, kandidater: 0, glavistaKilder: 0, skillende: new Set(), aar: [] };
  r.annonser += weight;
  if (union.length > 0) r.medKandidater += weight;
  r.kandidater += union.length * weight;
  if (glaCands.length > 0) r.glavistaKilder += weight;
  for (const f of skillende) r.skillende.add(f);
  if (svv.year) r.aar.push(svv.year);
  perFamilie.set(fam, r);
}

const rapport = [...perFamilie.entries()].map(([fam, r]) => ({
  familie: fam,
  annonser: r.annonser,
  dekningsgrad: Math.round((r.medKandidater / r.annonser) * 100),
  snittKandidater: Math.round((r.kandidater / r.annonser) * 10) / 10,
  glavistaAndel: Math.round((r.glavistaKilder / r.annonser) * 100),
  skillendeFeatures: [...r.skillende].sort(),
  aarSpenn: r.aar.length ? [Math.min(...r.aar), Math.max(...r.aar)] : null,
})).sort((a, b) => b.annonser - a.annonser);

const report = {
  meta: {
    generatedAt: new Date().toISOString(),
    prinsipp: 'Finn = markedssensor (aldri sannhet). Katalog/Glavista = kandidater (aldri EXACT). Glavista beviser OE→glass, ikke at bilen har OE.',
    kilde: { finnAnnonser: annonser.length, svvSvar: svvMap.size },
    oppdrag: 'C9.5 Phase 1 — kun topp 3 (BMW 3-SERIE, NISSAN LEAF, TESLA MODEL-Y). Ikke bygget bredt.',
  },
  familier: rapport,
  konklusjon: rapport.map((r) => ({
    familie: r.familie,
    dekning: r.dekningsgrad + '%',
    tiltak: r.dekningsgrad >= 90
      ? `kandidater finnes (gt/Glavista) — samle evidens via C8: ${r.skillendeFeatures.join('/') || 'OE-bilde'}`
      : `kandidatgap — bygg applikasjonskandidater (Glavista-modellnavn → SVV) + samle OE/installasjoner`,
  })),
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ familier: rapport.map((r) => `${r.familie}: ${r.annonser} annonser, ${r.dekningsgrad}% med kandidater (${r.snittKandidater} snitt, ${r.glavistaAndel}% via Glavista), skiller: ${r.skillendeFeatures.join('/') || '—'}`) }, null, 1));
