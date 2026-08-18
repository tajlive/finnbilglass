/**
 * C6 — FinnBilGlass Vehicle Intelligence Test Platform (kjøres fra scripts/).
 * Personvern: regnr/VIN kun som sha256-hash med salt; kun {make, model, year} til resolver.
 * Korpus → kjede per kjøretøy → per-familie-statistikk → prioritering → hull-rapport.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const SALT = process.env.C6_SALT || 'finnbilglass-c6-dev-salt';
const CORPUS_FILES = [
  'data/finn-modeller/svv-verifisert.ndjson',
  'data/test-500-gt-detaljer.jsonl',
  'data/finn-100.jsonl',
  '/Users/taj/bilglass/data/finn-no-regnr/svv-finn-broad-results.ndjson',
];
const OUT = resolve('scripts/out/c6-vehicle-intelligence.json');

const hash = (id) => createHash('sha256').update(`${id}::${SALT}`).digest('hex').slice(0, 16);

// ── 1) Korpus: last + pseudonymiser + dedupe ──
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
      make: String(r.merke ?? r.make ?? r.brand ?? '').toUpperCase(),
      model: String(r.modell ?? r.model ?? '').toUpperCase(),
      year: r.aar != null ? Number(r.aar) : r.year != null ? Number(r.year) : null,
    });
  }
}

// ── 2) Modell-normalisering → familie-nøkkel (deterministisk) ──
function familyKey(v) {
  const mk = v.make.replace('MERCEDES-BENZ', 'MERCEDES').replace('VOLKSWAGEN', 'VW');
  // fjern merke-prefiks fra modell (M1-mønster: «TOYOTA TOYOTA RAV4» → RAV4)
  let mo = v.model;
  const toks = mo.split(/\s+/);
  if (toks[0] === mk || toks[0] === v.make) mo = toks.slice(1).join(' ');
  // komma-variant: «AUDI A4, S4» → A4
  mo = mo.split(',')[0].trim();
  // støy-stripp: kW/kWh, bindestrek-tokens
  mo = mo.replace(/\d+\s*KW/i, '').replace(/\s*-\s*$/, '').trim();
  return `${mk} ${mo.split(/\s+/).slice(0, 3).join(' ')}`;
}

// ── 3) Applikasjonsoppslag (offline-register: T5/CLA + eksempler) ──
const APP_REGISTRY = [
  { fam: 'VW TRANSPORTER', make: 'VW', matcher: /TRANSPORTER/i },
  { fam: 'MERCEDES CLA', make: 'MERCEDES', matcher: /CLA/i },
  { fam: 'MERCEDES SPRINTER', make: 'MERCEDES', matcher: /SPRINTER/i },
  { fam: 'BMW 1-SERIE', make: 'BMW', matcher: /^1\b|1-SERIE|1 SERIE|116|118|120|125/ },
  { fam: 'BMW 3-SERIE', make: 'BMW', matcher: /^3\b|3-SERIE|3 SERIE|316|318|320|325|330/ },
  { fam: 'VOLVO XC60', make: 'VOLVO', matcher: /XC60/ },
  { fam: 'VOLVO XC90', make: 'VOLVO', matcher: /XC90/ },
  { fam: 'AUDI A4', make: 'AUDI', matcher: /^A4|A4 / },
  { fam: 'AUDI Q5', make: 'AUDI', matcher: /Q5/ },
  { fam: 'TESLA MODEL 3', make: 'TESLA', matcher: /MODEL 3/ },
  { fam: 'TOYOTA PROACE', make: 'TOYOTA', matcher: /PROACE/ },
  { fam: 'TOYOTA HILUX', make: 'TOYOTA', matcher: /HILUX/ },
  { fam: 'FORD TRANSIT', make: 'FORD', matcher: /TRANSIT/ },
  { fam: 'OPEL CORSA', make: 'OPEL', matcher: /CORSA/ },
  { fam: 'OPEL ASTRA', make: 'OPEL', matcher: /ASTRA/ },
];
function resolveApplication(v) {
  for (const a of APP_REGISTRY) {
    if (v.make === a.make && a.matcher.test(v.model)) return { family: a.fam, found: true };
  }
  return { family: null, found: false };
}

// ── 4) Kjør kjeden per kjøretøy ──
const families = new Map();
const totals = { vehicles: corpus.length, withVin: 0, applicationFound: 0, candidateSingle: 0, candidateMulti: 0, candidateNone: 0 };

for (const v of corpus) {
  if (v.vinHash) totals.withVin++;
  const fam = familyKey(v);
  const app = resolveApplication(v);
  // kandidat-simulering: applikasjon funnet → minst 1 kandidat (offline-register har T5-multi-variant)
  const candidates = app.found ? (app.family === 'VW TRANSPORTER' || app.family === 'MERCEDES CLA' ? 6 : 1) : 0;
  if (candidates === 0) totals.candidateNone++;
  else if (candidates === 1) totals.candidateSingle++;
  else totals.candidateMulti++;
  if (app.found) totals.applicationFound++;

  const f = families.get(fam) ?? { key: fam, vehicles: 0, withVin: 0, applicationFound: 0, multiVariant: 0, singleVariant: 0, noCandidate: 0 };
  f.vehicles++; if (v.vinHash) f.withVin++;
  if (app.found) f.applicationFound++;
  if (candidates > 1) f.multiVariant++; else if (candidates === 1) f.singleVariant++; else f.noCandidate++;
  families.set(fam, f);
}

// ── 5) Prioriteringsmotor: verdi = biler × variantrisiko × manglende data ──
const ranked = [...families.values()]
  .map((f) => {
    const variantRisk = f.multiVariant > 0 ? 2 : 1;           // flere varianter = høyere feilbestillingsrisiko
    const dataGap = f.applicationFound / f.vehicles;           // 0 = fullt gap
    const value = Math.round(f.vehicles * variantRisk * (1 + (1 - dataGap)) * 10) / 10;
    return { ...f, dataGap: Math.round((1 - dataGap) * 1000) / 10, value };
  })
  .sort((a, b) => b.value - a.value);

const report = {
  meta: { generatedAt: new Date().toISOString(), corpusFiles: CORPUS_FILES.filter((f) => existsSync(f)), privacy: 'regnr/VIN kun sha256-hash; ingen eierdata; kun {make,model,year} til resolver' },
  totals,
  coverage: {
    vehicleIdentityCoverage: Math.round((totals.vehicles / totals.vehicles) * 1000) / 10,
    vinCoverage: Math.round((totals.withVin / totals.vehicles) * 1000) / 10,
    applicationResolutionCoverage: Math.round((totals.applicationFound / totals.vehicles) * 1000) / 10,
    candidateCoverage: Math.round(((totals.candidateSingle + totals.candidateMulti) / totals.vehicles) * 1000) / 10,
  },
  familyCount: families.size,
  topFamilies: ranked.slice(0, 25),
  dataAcquisitionPriority: ranked.filter((f) => f.dataGap > 0).slice(0, 15).map((f) => ({ family: f.key, vehicles: f.vehicles, dataGapPct: f.dataGap, why: 'mange biler × manglende applikasjon/OE-data → TecDoc/EPC-fokus' })),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ totals, coverage: report.coverage, familyCount: report.familyCount, top5: report.topFamilies.slice(0, 5).map((f) => `${f.key}: ${f.vehicles} biler, verdi ${f.value}, gap ${f.dataGap}%`) }, null, 1));
console.log('Rapport: ' + OUT);
