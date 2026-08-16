// Rens ground_truth for rader som peker på IKKE-frontrute-glasstyper
// (side/bak/dør/ventil/tak/soltak/pakning/pyntelist).
//
// Klassifisering: erFrontrute() fra scripts/gt-generator.mjs — SAMME doktrine som
// vin-resolver.ts (avvis kun klare signaler; veteran 2-sifrede koder og
// «BYTTNR»-plassholdere faller gjennom som frontrute-kandidater).
//
// Historie:
//   v1 (2026-08-16): posisjonssjekk L/R/B kun — slettet 31 side/bak-rader.
//   v2 (2026-08-16): full erFrontrute-klassifisering (keyword + B/F/L/R/S-posisjon).
//     Rotårsak: gt-generators IKKE-liste manglet SOLTAK/PAKNING/SIDORUTA og
//     posisjonssjekken fanget ikke F=ventil/S=side.
//
// Bruk:
//   node scripts/clean-gt-side-glass.mjs           # dry-run: lister + backup, sletter IKKE
//   node scripts/clean-gt-side-glass.mjs --apply   # backup + slett de feilaktige radene
//
// Backup skrives ALLTID til data/gt-side-glass-backup.json før evt. sletting.

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { erFrontrute } from './gt-generator.mjs';

const DB = 'finnbilglass-db';
const APPLY = process.argv.includes('--apply');

function d1(sql) {
  const out = execSync(
    `npx wrangler d1 execute ${DB} --remote --json --command ${JSON.stringify(sql)}`,
    { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 }
  );
  return JSON.parse(out);
}

// 1) Alle glass-rader → oppslag både på varenr og eurokode (GT-kolonnen
//    «frontrute_eurocode» inneholder VARENR, men b2b-seed kan ha eurokode).
const glassRes = d1(`SELECT varenr, eurokode, varenavn FROM autoglass_prisliste WHERE rad_type='glass'`);
const glass = glassRes[0].results ?? [];
const byVarenr = new Map();
const byEuro = new Map();
for (const g of glass) {
  if (g.varenr != null) byVarenr.set(String(g.varenr).trim().toUpperCase(), g);
  if (g.eurokode != null) byEuro.set(String(g.eurokode).trim().toUpperCase(), g);
}

// 2) Alle GT-rader → klassifiser mot prislista
const gtRes = d1(`SELECT make, model, year, frontrute_eurocode, source FROM ground_truth`);
const gt = gtRes[0].results ?? [];

const bad = [];
const badBySource = {};
const ambiguous = [];
let utenTreff = 0;

for (const r of gt) {
  const kode = String(r.frontrute_eurocode ?? '').trim().toUpperCase();
  const kandidater = [byVarenr.get(kode), byEuro.get(kode)].filter(Boolean);
  // Dedupe identiske rader (kode = både eget varenr og annens eurokode)
  const unike = [...new Map(kandidater.map((g) => [String(g.varenr) + '|' + String(g.eurokode), g])).values()];
  if (unike.length === 0) { utenTreff++; continue; }
  const dommer = unike.map((g) => erFrontrute(g.varenavn ?? '', String(g.varenr ?? ''), g.eurokode));
  const noenFrontrute = dommer.some((d) => d);
  const alleIkke = dommer.every((d) => !d);
  if (alleIkke) {
    const g = unike[0];
    bad.push({ make: r.make, model: r.model, year: r.year, frontrute_eurocode: kode, source: r.source, varenavn: g.varenavn, eurokode: g.eurokode, varenr: g.varenr });
    badBySource[r.source ?? '?'] = (badBySource[r.source ?? '?'] ?? 0) + 1;
  } else if (!noenFrontrute) {
    ambiguous.push(kode);
  }
}

console.log(`Glass-rader i prislista: ${glass.length}`);
console.log(`GT-rader totalt: ${gt.length}`);
console.log(`GT-rader uten prisliste-treff (beholdes): ${utenTreff}`);
console.log(`\nIKKE-frontrute (slettes ved --apply): ${bad.length} rader`);
for (const [src, n] of Object.entries(badBySource)) console.log(`  ${src}: ${n}`);
if (ambiguous.length) console.log(`\nAmbiguous (motstridende klassifisering, beholdes): ${ambiguous.length}`);

// Eksempler (maks 12) for menneskelig kontroll
console.log('\nEksempler:');
for (const r of bad.slice(0, 12)) {
  console.log(`  ${String(r.make).padEnd(14)} ${String(r.model).padEnd(24)} ${String(r.year).padEnd(6)} ${r.frontrute_eurocode} → ek=${r.eurokode ?? '–'} (${r.varenavn ?? ''})`);
}

// Backup ALLTID (uansett dry-run/apply)
writeFileSync('data/gt-side-glass-backup.json', JSON.stringify(bad, null, 2));
console.log(`\nBackup skrevet: data/gt-side-glass-backup.json (${bad.length} rader)`);

if (!APPLY) {
  console.log('[DRY-RUN] Ingen sletting. Kjør med --apply for å slette ovenstående rader.');
  process.exit(0);
}

// Slett per PK-nøkkel (make, model, year, frontrute_eurocode) — treffer kun de
// klassifiserte radene, aldri andre rader med samme kode i annen kontekst.
const pkList = [...new Set(bad.map((r) => `('${String(r.make).replace(/'/g, "''")}','${String(r.model).replace(/'/g, "''")}',${r.year == null ? 'NULL' : r.year},'${r.frontrute_eurocode.replace(/'/g, "''")}')`))];
// Chunk for å unngå for store statements
const CHUNK = 200;
let total = 0;
for (let i = 0; i < pkList.length; i += CHUNK) {
  const chunk = pkList.slice(i, i + CHUNK).join(',');
  const del = d1(`DELETE FROM ground_truth WHERE (make, model, year, frontrute_eurocode) IN (${chunk})`);
  const meta = del[0]?.meta ?? del[0];
  total += meta?.changes ?? 0;
}
console.log(`\nSlettet rader: ${total}`);
