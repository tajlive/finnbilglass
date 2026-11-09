#!/usr/bin/env node
/**
 * testgrunnlag-inventar — finner det faktiske testgrunnlaget i repoet.
 *
 * Kilder (kun lesing, ingen scraping):
 *   data/testgrunnlag/testgrunnlag-v1-privat.csv   (har test_id + bilopplysninger)
 *   data/fixtures/self-test-50-cars.json           (har regnr + merke/modell/år)
 *   data/finn-100.jsonl                            (110 biler)
 *   øvrige filer med kjennemerker                  (telles, brukes som reserve)
 *
 * Skiller ekte biler fra syntetiske testdata, dedupliserer og skriver et fast
 * manifest med test-ID-er. Kjennemerker skrives bare i manifestet (internt) —
 * rapporter skal bruke test_id.
 *
 * Bruk: node --import tsx scripts/testgrunnlag-inventar.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';

// Kjennemerker som er dokumentert syntetiske testdata i testene.
const SYNTETISKE = new Set(['SU18018', 'AJ95429', 'DS30475', 'AB12345', 'TEST99998']);

const REG = /\b([A-ZÆØÅ]{2})\s?(\d{5})\b/g;

function lesCsv(sti) {
  const linjer = readFileSync(sti, 'utf8').split('\n').filter((l) => l.trim());
  const hode = linjer[0].split(',');
  return linjer.slice(1).map((l) => {
    const deler = l.split(',');
    return Object.fromEntries(hode.map((h, i) => [h.trim(), (deler[i] ?? '').trim()]));
  });
}

function lesJsonl(sti) {
  return readFileSync(sti, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

const biler = new Map(); // regnr -> { regnr, merke, modell, aar, kilder[] , test_id? }
const kilderPerFil = {};

function leggTil(regnr, data, kilde) {
  const r = String(regnr).toUpperCase().replace(/\s+/g, '');
  if (!/^[A-ZÆØÅ]{2}\d{5}$/.test(r)) return;
  const finnes = biler.get(r) ?? { regnr: r, merke: null, modell: null, aar: null, kilder: [], test_id: null };
  finnes.merke = finnes.merke ?? data.merke ?? null;
  finnes.modell = finnes.modell ?? data.modell ?? null;
  finnes.aar = finnes.aar ?? data.aar ?? null;
  finnes.test_id = finnes.test_id ?? data.test_id ?? null;
  if (!finnes.kilder.includes(kilde)) finnes.kilder.push(kilde);
  biler.set(r, finnes);
  kilderPerFil[kilde] = (kilderPerFil[kilde] ?? 0) + 1;
}

// 1) Testgrunnlag med test_id (primærkilde)
const TG = 'data/testgrunnlag/testgrunnlag-v1-privat.csv';
for (const rad of lesCsv(TG)) {
  leggTil(rad.kjennemerke, { test_id: rad.test_id, merke: rad.merke, modell: rad.modell, aar: Number(rad.aar) || null }, TG);
}

// 2) Selvtest-50
const S50 = 'data/fixtures/self-test-50-cars.json';
const s50 = JSON.parse(readFileSync(S50, 'utf8'));
for (const b of s50.biler ?? []) leggTil(b.regnr, { merke: b.merke, modell: b.modell, aar: b.aar }, S50);

// 3) finn-100
const F100 = 'data/finn-100.jsonl';
for (const b of lesJsonl(F100)) leggTil(b.regnr, { merke: b.merke, modell: b.modell, aar: b.aar }, F100);

// 4) Resten av repoet: tell og ta med biler som ellers ikke er funnet
const rot = '.';
const hoppOver = new Set(['node_modules', '.git', '.wrangler', 'dist', 'coverage', 'scripts', 'tests']);
function gaa(dir) {
  for (const navn of readdirSync(dir)) {
    const sti = join(dir, navn);
    if (navn.startsWith('.') && navn !== '.hermes') continue;
    let st;
    try { st = statSync(sti); } catch { continue; }
    if (st.isDirectory()) { if (!hoppOver.has(navn)) gaa(sti); continue; }
    if (!['.json', '.jsonl', '.csv', '.md', '.txt'].includes(extname(sti))) continue;
    if (st.size > 8_000_000) continue;
    let tekst;
    try { tekst = readFileSync(sti, 'utf8'); } catch { continue; }
    for (const m of tekst.toUpperCase().matchAll(REG)) {
      const r = m[1] + m[2];
      if (SYNTETISKE.has(r)) continue;
      if (!biler.has(r)) leggTil(r, {}, sti);
      else kilderPerFil[sti] = (kilderPerFil[sti] ?? 0) + 1;
    }
  }
}
gaa(rot);

// Klassifiser
const liste = [...biler.values()].map((b) => ({
  ...b,
  syntetisk: SYNTETISKE.has(b.regnr),
  harBilopplysninger: !!(b.merke && b.modell),
  test_id: b.test_id ?? 'FBG-X-' + createHash('sha256').update(b.regnr).digest('hex').slice(0, 6).toUpperCase(),
}));

// Sorter: ekte med bilopplysninger først, deretter år
liste.sort((a, b) => Number(a.syntetisk) - Number(b.syntetisk) || (a.aar ?? 0) - (b.aar ?? 0) || a.regnr.localeCompare(b.regnr));

const merker = {};
const aarGrener = { '<=2010': 0, '2011-2019': 0, '>=2020': 0, ukjent: 0 };
for (const b of liste) {
  if (b.merke) merker[b.merke] = (merker[b.merke] ?? 0) + 1;
  if (!b.aar) aarGrener.ukjent += 1;
  else if (b.aar <= 2010) aarGrener['<=2010'] += 1;
  else if (b.aar <= 2019) aarGrener['2011-2019'] += 1;
  else aarGrener['>=2020'] += 1;
}

const manifest = {
  laget: new Date().toISOString(),
  kilder: Object.keys(kilderPerFil).sort((a, b) => kilderPerFil[b] - kilderPerFil[a]),
  kilderAntall: kilderPerFil,
  antall: liste.length,
  ekte: liste.filter((b) => !b.syntetisk).length,
  syntetiske: liste.filter((b) => b.syntetisk).length,
  medBilopplysninger: liste.filter((b) => b.harBilopplysninger).length,
  merker,
  aarGrener,
  biler: liste,
};
manifest.sha256 = createHash('sha256').update(JSON.stringify(liste)).digest('hex');

writeFileSync('data/testgrunnlag/manifest-v2.json', JSON.stringify(manifest, null, 2), 'utf8');

console.log('=== TESTGRUNNLAG ===');
console.log('unike kjennemerker:', manifest.antall, '| ekte:', manifest.ekte, '| syntetiske:', manifest.syntetiske);
console.log('med bilopplysninger (merke+modell):', manifest.medBilopplysninger);
console.log('årgrupper:', JSON.stringify(aarGrener));
console.log('merker:', Object.entries(merker).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(', '));
console.log('manifest-sha256:', manifest.sha256.slice(0, 32));
console.log('skrevet: data/testgrunnlag/manifest-v2.json');
