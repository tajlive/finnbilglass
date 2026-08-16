// Clean GT-rader der frontrute_eurocode (varenr) peker på SIDE-/BAK-glass —
// feilklassen fra erFrontrute-buggen (3-sifret eurokode-prefiks «538LRG…» slapp gjennom).
//
// Logikk: join ground_truth → autoglass_prisliste (varenr), klassifiser eurokode-posisjon
// (første bokstav etter 3–5-sifret prefiks): A=front, L/R=side, B=bakrute.
//
// Bruk:
//   node scripts/clean-gt-side-glass.mjs           # dry-run: lister + backup til fil, sletter IKKE
//   node scripts/clean-gt-side-glass.mjs --apply   # backup + slett de feilaktige radene
//
// Backup skrives ALLTID til data/gt-side-glass-backup.json før evt. sletting.

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DB = 'finnbilglass-db';
const APPLY = process.argv.includes('--apply');

function posisjon(ek) {
  if (!ek) return '?';
  const e = ek.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = e.match(/^(\d{3,5})([A-Z])/);
  return m ? m[2] : '?';
}

function d1(sql) {
  const out = execSync(
    `npx wrangler d1 execute ${DB} --remote --json --command ${JSON.stringify(sql)}`,
    { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 }
  );
  return JSON.parse(out);
}

const join = d1(
  `SELECT g.make, g.model, g.year, g.frontrute_eurocode AS varenr, p.eurokode, p.varenavn FROM ground_truth g JOIN autoglass_prisliste p ON g.frontrute_eurocode = p.varenr`
);
const rows = join[0].results ?? [];

const bad = rows.filter((r) => ['L', 'R', 'B'].includes(posisjon(r.eurokode)));
const seen = new Set();
const unike = [];
for (const r of bad) {
  const k = `${r.make}|${r.model}|${r.varenr}`;
  if (!seen.has(k)) { seen.add(k); unike.push(r); }
}

console.log(`Totalt GT-rader (join prisliste): ${rows.length}`);
console.log(`FEIL (side/bak klassifisert som frontrute): ${bad.length} rader, ${unike.length} unike (varenr,modell)`);
for (const r of unike) {
  console.log(`  ${posisjon(r.eurokode)} ${r.make.padEnd(11)} ${r.model.padEnd(26)} ${String(r.varenr).padEnd(10)} ${r.eurokode} — ${r.varenavn}`);
}

// Backup ALLTID (uansett dry-run/apply)
writeFileSync('data/gt-side-glass-backup.json', JSON.stringify(bad, null, 2));
console.log(`\nBackup skrevet: data/gt-side-glass-backup.json (${bad.length} rader)`);

if (!APPLY) {
  console.log('[DRY-RUN] Ingen sletting. Kjør med --apply for å slette ovenstående rader.');
  process.exit(0);
}

const varenrList = [...new Set(bad.map((r) => String(r.varenr).replace(/'/g, "''")))]
  .map((v) => `'${v}'`).join(',');
const del = d1(`DELETE FROM ground_truth WHERE frontrute_eurocode IN (${varenrList})`);
const meta = del[0]?.meta ?? del[0];
console.log(`\nSlettet rader: ${meta?.changes ?? JSON.stringify(del)}`);
