#!/usr/bin/env node
/**
 * Sammenligner to pilot-kjøringer (før/etter en kodeendring) på test-ID.
 *
 * Rapporterer: endret utfall, endret kandidatantall, nye tekniske feil,
 * latens-forskyvning, og en egen RAV4-linje (CTO ba om det spesifikt).
 *
 * Bruk: node scripts/pilot-sammenlign.mjs <før.csv> <etter.csv>
 */
import { readFileSync, existsSync } from 'node:fs';

const [forFil, etterFil] = process.argv.slice(2);
if (!forFil || !etterFil) {
  console.error('Bruk: node scripts/pilot-sammenlign.mjs <før.csv> <etter.csv>');
  process.exit(2);
}
for (const f of [forFil, etterFil]) {
  if (!existsSync(f)) { console.error(`Mangler ${f}`); process.exit(2); }
}

const les = (p) => {
  const linjer = readFileSync(p, 'utf8').trim().split('\n');
  const hode = linjer[0].split(',');
  return linjer.slice(1).map((l) => Object.fromEntries(hode.map((h, i) => [h, l.split(',')[i] ?? ''])));
};

const for_ = new Map(les(forFil).map((r) => [r.test_id, r]));
const etter = les(etterFil);

let endret = 0, bedre = 0, darligere = 0;
const detaljer = [];
let sumFor = 0, sumEtter = 0;

for (const e of etter) {
  const f = for_.get(e.test_id);
  if (!f) continue;
  sumFor += Number(f.ms || 0);
  sumEtter += Number(e.ms || 0);
  const kFor = Number(f.kandidatantall || 0);
  const kEtter = Number(e.kandidatantall || 0);
  if (f.utfall !== e.utfall || kFor !== kEtter || f.teknisk_utfall !== e.teknisk_utfall) {
    endret++;
    if (kEtter > kFor) bedre++;
    else if (kEtter < kFor) darligere++;
    detaljer.push({ test_id: e.test_id, bil: `${e.merke} ${e.modell} ${e.aar}`, før: `${f.utfall}/${kFor}`, etter: `${e.utfall}/${kEtter}`, teknisk: e.teknisk_utfall });
  }
}

const snitt = (s, n) => Math.round(s / n);
console.log(`sammenlignet ${etter.length} biler`);
console.log(`  endret utfall/kandidater: ${endret} (flere kandidater: ${bedre}, færre: ${darligere})`);
console.log(`  gjennomsnittlig latens: ${snitt(sumFor, etter.length)} ms → ${snitt(sumEtter, etter.length)} ms`);
const nyeTekniskeFeil = etter.filter((e) => e.teknisk_utfall !== 'OK');
console.log(`  tekniske feil etter endringen: ${nyeTekniskeFeil.length}`);

if (detaljer.length) {
  console.log('\ntest_id      bil                                      før         etter');
  for (const d of detaljer) {
    console.log(`${d.test_id}  ${d.bil.padEnd(38).slice(0, 38)}  ${d.før.padEnd(11)} ${d.etter}`);
  }
}

const rav = etter.filter((e) => /RAV/i.test(`${e.merke} ${e.modell}`));
if (rav.length) {
  console.log('\nRAV4-linjen:');
  for (const r of rav) {
    const f = for_.get(r.test_id);
    console.log(`  ${r.test_id} ${r.merke} ${r.modell} ${r.aar}: ${f?.utfall}/${f?.kandidatantall} kandidater → ${r.utfall}/${r.kandidatantall}`);
  }
}
